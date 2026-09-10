import base64
import io
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

import bcrypt
import jwt
import qrcode
import requests
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

try:
    import pytesseract
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
except ImportError:
    pytesseract = None

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).with_name('.env'))
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent
configured_database_path = Path(os.getenv('DATABASE_PATH', 'database.sqlite'))
DATABASE_PATH = configured_database_path if configured_database_path.is_absolute() else BASE_DIR.parent / configured_database_path
if os.getenv('VERCEL') == '1':
    DATABASE_PATH = Path('/tmp/hospital-discharge.sqlite')
    UPLOAD_DIR = Path('/tmp/hospital-discharge-uploads')
else:
    UPLOAD_DIR = BASE_DIR / 'uploads' / 'prescriptions'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JWT_SECRET = os.getenv('JWT_SECRET', 'your_jwt_secret_key_change_this_in_production_123456789')
JWT_EXPIRE = os.getenv('JWT_EXPIRE', '7d')
HOSPITAL_NAME = os.getenv('HOSPITAL_NAME', 'Hospital Discharge System')
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
origins = [value.strip() for value in os.getenv('CORS_ORIGIN', 'http://localhost:8000,http://localhost:3000,https://med-vault-ddcjxwt2z-piyushlalwani085-6632s-projects.vercel.app').split(',') if value.strip()]
CORS(app, origins=origins or '*', supports_credentials=True)


def get_db():
    if 'db' not in g:
        DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript('''
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, staffId TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL, name TEXT NOT NULL, department TEXT NOT NULL,
        role TEXT DEFAULT 'Doctor', phone TEXT, status TEXT DEFAULT 'Active',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY, mrn TEXT UNIQUE NOT NULL, name TEXT NOT NULL, age INTEGER,
        disease TEXT NOT NULL, testDetails TEXT NOT NULL, gender TEXT, bloodGroup TEXT,
        phone TEXT, email TEXT, address TEXT, emergencyContact TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME
      );
      CREATE TABLE IF NOT EXISTS discharges (
        id TEXT PRIMARY KEY, dischargeId TEXT UNIQUE NOT NULL, patientId TEXT NOT NULL,
        admissionDate DATE, dischargeDate DATE, diagnosis TEXT, treatment TEXT,
        dischargeInstructions TEXT, status TEXT DEFAULT 'Draft', createdById TEXT,
        approvedById TEXT, qrCode TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME, FOREIGN KEY (patientId) REFERENCES patients(id)
      );
      CREATE TABLE IF NOT EXISTS prescriptions (
        id TEXT PRIMARY KEY, dischargeId TEXT NOT NULL, filename TEXT NOT NULL,
        originalUrl TEXT NOT NULL, rawText TEXT, medicines TEXT, doctor TEXT,
        clinicName TEXT, prescriptionDate DATE, status TEXT DEFAULT 'Pending',
        verifiedById TEXT, confidence INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dischargeId) REFERENCES discharges(id)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, patientId TEXT NOT NULL, type TEXT NOT NULL, title TEXT,
        message TEXT, testName TEXT, testDate DATE, testTime TEXT, location TEXT,
        instructions TEXT, channel TEXT DEFAULT 'In-App', scheduledFor DATETIME,
        status TEXT DEFAULT 'Pending', sentAt DATETIME, retries INTEGER DEFAULT 0,
        createdById TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patientId) REFERENCES patients(id)
      );
    ''')
    db.commit()


@app.before_request
def prepare_database():
    init_db()


def row_dict(row):
    return dict(row) if row else None


def rows_dict(rows):
    return [dict(row) for row in rows]


def error(message, status=400):
    return jsonify(error=message), status


def parse_expiry(value):
    match = re.fullmatch(r'(\d+)([smhd])', value or '7d')
    if not match:
        return timedelta(days=7)
    amount, unit = int(match.group(1)), match.group(2)
    return {'s': timedelta(seconds=amount), 'm': timedelta(minutes=amount), 'h': timedelta(hours=amount), 'd': timedelta(days=amount)}[unit]


def make_token(user):
    now = datetime.now(timezone.utc)
    payload = {
        'id': user['id'], 'staffId': user['staffId'], 'name': user['name'],
        'department': user['department'], 'role': user['role'],
        'iat': now, 'exp': now + parse_expiry(JWT_EXPIRE)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def auth_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return error('Authentication required', 401)
        try:
            g.user = jwt.decode(header[7:], JWT_SECRET, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return error('Token expired', 401)
        except jwt.InvalidTokenError:
            return error('Invalid token', 401)
        return fn(*args, **kwargs)
    return wrapped


def roles(*allowed):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if g.user.get('role') not in allowed:
                return error('You do not have permission to perform this action', 403)
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def active_user_by_staff(staff_id):
    return get_db().execute('SELECT * FROM users WHERE staffId = ?', (staff_id,)).fetchone()


def user_public(user):
    return {key: user[key] for key in ('id', 'staffId', 'name', 'department', 'role', 'status') if key in user.keys()}


@app.post('/api/auth/login')
def login():
    data = request.get_json(silent=True) or {}
    user = active_user_by_staff(data.get('staffId', ''))
    if not user or user['status'] != 'Active' or user['role'] not in ('Doctor', 'Nurse', 'Admin'):
        return error('Invalid credentials', 401)
    if not bcrypt.checkpw(str(data.get('password', '')).encode(), user['password'].encode()):
        return error('Invalid credentials', 401)
    return jsonify(success=True, token=make_token(user), user=user_public(user))


@app.post('/api/auth/signup')
def signup():
    data = request.get_json(silent=True) or {}
    required = ['staffId', 'email', 'password', 'name', 'department']
    if any(not data.get(field) for field in required):
        return error('All fields are required')
    db = get_db()
    try:
        user_id = str(uuid.uuid4())
        password = bcrypt.hashpw(str(data['password']).encode(), bcrypt.gensalt(10)).decode()
        db.execute('INSERT INTO users (id, staffId, email, password, name, department, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                   (user_id, data['staffId'], data['email'], password, data['name'], data['department'], data.get('role', 'Doctor'), 'Active'))
        db.commit()
        return jsonify(success=True, message='Staff account created successfully', staff={'id': user_id, 'staffId': data['staffId'], 'status': 'Active'}), 201
    except sqlite3.IntegrityError:
        return error('Staff ID or email already exists', 409)


@app.get('/api/auth/staff-list')
@auth_required
@roles('Admin')
def staff_list():
    rows = get_db().execute('SELECT id, staffId, email, name, department, role, status, createdAt FROM users ORDER BY createdAt DESC').fetchall()
    return jsonify(success=True, staff=rows_dict(rows))


@app.get('/api/auth/staff/pending')
@auth_required
@roles('Admin')
def pending_staff():
    rows = get_db().execute("SELECT id, staffId, email, name, department, role, status, createdAt FROM users WHERE status = 'Pending' ORDER BY createdAt DESC").fetchall()
    return jsonify(success=True, staff=rows_dict(rows))


@app.post('/api/auth/staff')
@auth_required
@roles('Admin')
def create_staff():
    data = request.get_json(silent=True) or {}
    required = ['staffId', 'email', 'password', 'name', 'department']
    if any(not data.get(field) for field in required):
        return error('All fields are required')
    db = get_db()
    try:
        user_id = str(uuid.uuid4())
        hashed = bcrypt.hashpw(str(data['password']).encode(), bcrypt.gensalt(10)).decode()
        db.execute('INSERT INTO users (id, staffId, email, password, name, department, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                   (user_id, data['staffId'], data['email'], hashed, data['name'], data['department'], data.get('role', 'Doctor'), 'Active'))
        db.commit()
        return jsonify(success=True, staff={'id': user_id, 'staffId': data['staffId'], 'status': 'Active'}), 201
    except sqlite3.IntegrityError:
        return error('Staff ID or email already exists', 409)


@app.post('/api/auth/staff/<staff_id>/approve')
@auth_required
@roles('Admin')
def approve_staff(staff_id):
    result = get_db().execute("UPDATE users SET status = 'Active' WHERE id = ? AND status = 'Pending'", (staff_id,))
    get_db().commit()
    if not result.rowcount:
        return error('Pending staff member not found', 404)
    return jsonify(success=True, message='Staff member approved')


@app.post('/api/auth/staff/<staff_id>/reject')
@auth_required
@roles('Admin')
def reject_staff(staff_id):
    result = get_db().execute("UPDATE users SET status = 'Rejected' WHERE id = ? AND status = 'Pending'", (staff_id,))
    get_db().commit()
    if not result.rowcount:
        return error('Pending staff member not found', 404)
    return jsonify(success=True, message='Staff member rejected')


@app.get('/api/patients/search')
@auth_required
def search_patients():
    query = str(request.args.get('q', '')).strip()
    if len(query) < 2:
        return error('Enter at least 2 characters to search')
    like = f'%{query}%'
    db = get_db()
    patients = db.execute('SELECT * FROM patients WHERE name LIKE ? OR mrn LIKE ? OR phone LIKE ? ORDER BY updatedAt DESC, createdAt DESC LIMIT 20', (like, like, like)).fetchall()
    results = []
    for patient in patients:
        discharges = db.execute('''SELECT d.*, GROUP_CONCAT(pr.medicines, '|||') AS prescriptionData
          FROM discharges d LEFT JOIN prescriptions pr ON pr.dischargeId = d.id
          WHERE d.patientId = ? GROUP BY d.id ORDER BY d.createdAt DESC''', (patient['id'],)).fetchall()
        discharge_data = []
        for discharge in discharges:
            item = dict(discharge)
            medicines = []
            for value in filter(None, str(discharge['prescriptionData'] or '').split('|||')):
                try:
                    medicines.extend(json.loads(value))
                except json.JSONDecodeError:
                    pass
            item['prescriptions'] = medicines
            item.pop('prescriptionData', None)
            discharge_data.append(item)
        results.append({'patient': row_dict(patient), 'discharges': discharge_data})
    return jsonify(success=True, results=results)


@app.post('/api/patients')
@auth_required
def create_patient():
    data = request.get_json(silent=True) or {}
    if not data.get('name') or data.get('age') is None or not data.get('disease') or not data.get('testDetails'):
        return error('Name, age, disease, and test details are required')
    patient_id = str(uuid.uuid4())
    mrn = data.get('mrn') or f"MRN-{int(datetime.now().timestamp() * 1000)}-{patient_id[:8]}"
    db = get_db()
    try:
        db.execute('''INSERT INTO patients (id, mrn, name, age, disease, testDetails, gender, bloodGroup, phone, email, address, emergencyContact)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (patient_id, mrn, data['name'].strip(), int(data['age']), data['disease'].strip(), data['testDetails'].strip(), data.get('gender'), data.get('bloodGroup'), data.get('phone'), data.get('email'), data.get('address'), data.get('emergencyContact')))
        db.commit()
        return jsonify(success=True, patient=row_dict(db.execute('SELECT * FROM patients WHERE id = ?', (patient_id,)).fetchone())), 201
    except (ValueError, sqlite3.IntegrityError):
        return error('Invalid patient data or MRN already exists')


@app.get('/api/patients')
@auth_required
def get_patients():
    return jsonify(success=True, patients=rows_dict(get_db().execute('SELECT * FROM patients ORDER BY createdAt DESC').fetchall()))


@app.get('/api/patients/<patient_id>')
@auth_required
def get_patient(patient_id):
    patient = get_db().execute('SELECT * FROM patients WHERE id = ?', (patient_id,)).fetchone()
    return (jsonify(success=True, patient=row_dict(patient)) if patient else error('Patient not found', 404))


@app.put('/api/patients/<patient_id>')
@auth_required
def update_patient(patient_id):
    data = request.get_json(silent=True) or {}
    allowed = ['name', 'age', 'disease', 'testDetails', 'gender', 'bloodGroup', 'phone', 'email', 'address', 'emergencyContact']
    updates = [(key, data[key]) for key in allowed if key in data]
    if not updates:
        return error('No valid patient fields to update')
    db = get_db()
    query = ', '.join(f'{key} = ?' for key, _ in updates) + ', updatedAt = CURRENT_TIMESTAMP'
    result = db.execute(f'UPDATE patients SET {query} WHERE id = ?', [value for _, value in updates] + [patient_id])
    db.commit()
    if not result.rowcount:
        return error('Patient not found', 404)
    return jsonify(success=True, patient=row_dict(db.execute('SELECT * FROM patients WHERE id = ?', (patient_id,)).fetchone()))


@app.get('/api/notifications/pending')
@auth_required
def pending_notifications():
    rows = get_db().execute('''SELECT n.*, p.name AS patientName FROM notifications n
      LEFT JOIN patients p ON p.id = n.patientId WHERE n.status = 'Pending' ORDER BY n.createdAt DESC''').fetchall()
    return jsonify(success=True, notifications=rows_dict(rows))


@app.patch('/api/notifications/<notification_id>/read')
@auth_required
def read_notification(notification_id):
    result = get_db().execute("UPDATE notifications SET status = 'Read' WHERE id = ?", (notification_id,))
    get_db().commit()
    if not result.rowcount:
        return error('Notification not found', 404)
    return jsonify(success=True, message='Notification marked as read')


@app.post('/api/notifications/create-test-reminder')
@auth_required
def create_reminder():
    data = request.get_json(silent=True) or {}
    required = ['patientId', 'testName', 'testDate', 'testTime']
    if any(not data.get(field) for field in required):
        return error('Patient, test name, date, and time are required')
    notification_id = str(uuid.uuid4())
    db = get_db()
    db.execute('''INSERT INTO notifications (id, patientId, type, title, message, testName, testDate, testTime, location, instructions, createdById)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (notification_id, data['patientId'], 'Test Reminder', f"Test reminder: {data['testName']}", data.get('instructions'), data['testName'], data['testDate'], data['testTime'], data.get('location'), data.get('instructions'), g.user['id']))
    db.commit()
    return jsonify(success=True, notification={'id': notification_id, 'message': 'Test reminder created'}), 201


@app.errorhandler(413)
def too_large(error):
    return jsonify(error='Uploaded file is too large. Maximum size is 50 MB.'), 413


@app.errorhandler(Exception)
def handle_exception(exception):
    if isinstance(exception, sqlite3.IntegrityError):
        return jsonify(error='Database constraint failed'), 409
    app.logger.exception(exception)
    return jsonify(error=str(exception)), 500


def clean_value(value):
    return re.sub(r'\s+', ' ', str(value or '').strip(' \t\r\n:;,-'))


def field_value(text, labels, stops=()):
    label_pattern = '|'.join(labels)
    stop_pattern = '|'.join(stops)
    match = re.search(rf'(?:{label_pattern})\s*[:\-]?\s*(.+?)(?=\s+(?:{stop_pattern})\s*[:\-]|$)', text, re.I)
    return clean_value(match.group(1)) if match else ''


def parse_discharge_text(raw_text):
    text = re.sub(r'\s+', ' ', str(raw_text or '').replace('|', ' ')).strip()
    stop_labels = ('age', 'mrn', 'diagnosis', 'disease', 'tests?', 'admission', 'follow[- ]?up', 'discharge', 'treatment', 'patient name')
    patient_name = field_value(text, ('patient\s*name', 'paitent\s*name', 'patient'), stop_labels)
    age_match = re.search(r'\bage\s*(?:/\s*(?:sex|gender))?\s*[:\-]?\s*(\d{1,3})', text, re.I)
    mrn_match = re.search(r'(?:existing\s*mrn|mrn|ipd\s*no|patient\s*id|record\s*no|uhid)\s*[:\-]?\s*([A-Za-z0-9/-]{3,})', text, re.I)
    disease = field_value(text, ('final\s*diagnosis', 'provisional\s*diagnosis', 'diagnosis', 'disease', 'condition'), ('admission', 'tests?', 'follow[- ]?up', 'treatment'))
    tests = field_value(text, ('test\s*details', 'tests?', 'investigations?', 'lab(?:oratory)?\s*reports?', 'diagnostic\s*tests?'), ('admission', 'discharge', 'follow[- ]?up', 'treatment', 'diagnosis', 'disease'))
    admission_match = re.search(r'(?:date\s*(?:/\s*time)?\s*of\s*admission|admission\s*date|admitted\s*on|adm\.?\s*date)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', text, re.I)
    treatment = field_value(text, ('treatment\s*plan', 'treatment', 'procedure', 'surgery', 'management'), ('admission', 'diagnosis', 'disease', 'tests?', 'follow[- ]?up'))
    instructions = field_value(text, ('follow[- ]?up\s*advice', 'discharge\s*(?:advice|instructions)', 'follow[- ]?up'), ('admission', 'diagnosis', 'disease', 'tests?', 'treatment'))
    if not treatment:
        match = re.search(r'treatment\s*plan\s*[:\-]?\s*(.+?)(?=\s+(?:discharge\s*(?:advice|instructions)|follow[- ]?up)\s*[:\-]|$)', text, re.I)
        treatment = clean_value(match.group(1)) if match else ''
    if not instructions:
        match = re.search(r'(?:discharge\s*(?:advice|instructions)|follow[- ]?up\s*advice)\s*[:\-]?\s*(.+)$', text, re.I)
        instructions = clean_value(match.group(1)) if match else ''
    return {
        'patientName': patient_name, 'patientAge': age_match.group(1) if age_match else '',
        'patientMRN': re.sub(r'\s+', '', mrn_match.group(1)) if mrn_match else '',
        'patientDisease': disease, 'testDetails': tests,
        'admissionDate': admission_match.group(1) if admission_match else '',
        'diagnosis': disease, 'treatment': treatment, 'dischargeInstructions': instructions
    }


def prescription_data(row):
    value = row_dict(row)
    try:
        value['medicines'] = json.loads(value.get('medicines') or '[]')
    except json.JSONDecodeError:
        value['medicines'] = []
    return value


@app.post('/api/discharge/create')
@auth_required
def create_discharge():
    data = request.get_json(silent=True) or {}
    required = ['patientName', 'patientAge', 'patientDisease', 'testDetails', 'diagnosis']
    if any(not data.get(field) and data.get(field) != 0 for field in required):
        return error('Patient name, age, disease, test details, and diagnosis are required')
    try:
        age = int(data['patientAge'])
    except (ValueError, TypeError):
        return error('Patient age must be a valid whole number')
    db = get_db()
    patient = db.execute('SELECT * FROM patients WHERE mrn = ?', (data.get('patientMRN'),)).fetchone() if data.get('patientMRN') else None
    if not patient:
        patient_id = str(uuid.uuid4())
        mrn = data.get('patientMRN') or f"MRN-{int(datetime.now().timestamp() * 1000)}-{patient_id[:8]}"
        db.execute('INSERT INTO patients (id, mrn, name, age, disease, testDetails, gender, bloodGroup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (patient_id, mrn, data['patientName'], age, data['patientDisease'], data['testDetails'], data.get('patientGender'), data.get('bloodGroup')))
        patient = db.execute('SELECT * FROM patients WHERE id = ?', (patient_id,)).fetchone()
    discharge_id = str(uuid.uuid4())
    public_id = f'DC-{int(datetime.now().timestamp() * 1000)}'
    db.execute('INSERT INTO discharges (id, dischargeId, patientId, admissionDate, dischargeDate, diagnosis, treatment, dischargeInstructions, createdById) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (discharge_id, public_id, patient['id'], data.get('admissionDate'), data.get('dischargeDate'), data['diagnosis'], data.get('treatment', ''), data.get('dischargeInstructions', ''), g.user['id']))
    db.commit()
    return jsonify(success=True, discharge={'id': discharge_id, 'dischargeId': public_id, 'patientId': patient['id']})


@app.get('/api/discharge/all')
@auth_required
def all_discharges():
    rows = get_db().execute('SELECT d.*, p.name AS patientName, p.mrn FROM discharges d LEFT JOIN patients p ON p.id = d.patientId ORDER BY d.createdAt DESC').fetchall()
    return jsonify(success=True, discharges=rows_dict(rows))


@app.get('/api/index.py')
@app.get('/api')
def function_health():
    return jsonify(success=True, service='Hospital Discharge System API', status='ok')


@app.get('/')
def service_health():
    return jsonify(success=True, service='Hospital Discharge System API', status='ok')


def discharge_bundle(discharge_id):
    db = get_db()
    discharge = db.execute('SELECT * FROM discharges WHERE id = ?', (discharge_id,)).fetchone()
    if not discharge:
        return None
    patient = db.execute('SELECT * FROM patients WHERE id = ?', (discharge['patientId'],)).fetchone()
    prescriptions = db.execute('SELECT * FROM prescriptions WHERE dischargeId = ?', (discharge_id,)).fetchall()
    return discharge, patient, [prescription_data(row) for row in prescriptions]


@app.get('/api/discharge/<discharge_id>')
@auth_required
def get_discharge(discharge_id):
    bundle = discharge_bundle(discharge_id)
    if not bundle:
        return error('Discharge not found', 404)
    discharge, patient, prescriptions = bundle
    return jsonify(success=True, discharge=row_dict(discharge), patient=row_dict(patient), prescriptions=prescriptions)


@app.put('/api/discharge/<discharge_id>')
@auth_required
@roles('Doctor', 'Nurse', 'Admin')
def update_discharge(discharge_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    discharge = db.execute('SELECT * FROM discharges WHERE id = ?', (discharge_id,)).fetchone()
    if not discharge:
        return error('Discharge not found', 404)
    if discharge['status'] != 'Draft':
        return error('Only draft discharges can be edited', 409)
    if not data.get('diagnosis'):
        return error('Diagnosis is required')
    db.execute('UPDATE discharges SET admissionDate = ?, dischargeDate = ?, diagnosis = ?, treatment = ?, dischargeInstructions = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', (data.get('admissionDate'), data.get('dischargeDate'), data['diagnosis'], data.get('treatment'), data.get('dischargeInstructions'), discharge_id))
    db.commit()
    return jsonify(success=True, discharge=row_dict(db.execute('SELECT * FROM discharges WHERE id = ?', (discharge_id,)).fetchone()))


def run_local_ocr(file_path):
    if pytesseract is None:
        raise RuntimeError('Install pytesseract and the Tesseract system package to use local OCR.')
    image = Image.open(file_path)
    image = ImageOps.grayscale(image)
    image = ImageEnhance.Contrast(image).enhance(1.5)
    image = image.filter(ImageFilter.SHARPEN)
    return pytesseract.image_to_string(image)


def run_google_vision(file_path):
    api_key = os.getenv('GOOGLE_VISION_API_KEY', '').strip()
    if not api_key:
        return ''
    encoded = base64.b64encode(Path(file_path).read_bytes()).decode()
    response = requests.post(
        'https://vision.googleapis.com/v1/images:annotate',
        params={'key': api_key},
        json={'requests': [{'image': {'content': encoded}, 'features': [{'type': 'DOCUMENT_TEXT_DETECTION'}, {'type': 'TEXT_DETECTION'}]}]},
        timeout=60
    )
    response.raise_for_status()
    data = response.json().get('responses', [{}])[0]
    if data.get('error'):
        raise RuntimeError(data['error'].get('message', 'Google Vision failed'))
    return data.get('fullTextAnnotation', {}).get('text', '') or (data.get('textAnnotations') or [{}])[0].get('description', '')


def enrich_summary(raw_text, parsed):
    api_key = os.getenv('GROQ_API_KEY', '').strip()
    if not api_key:
        return parsed
    prompt = ('You are a clinical document assistant. Read this hospital discharge text and return JSON only with exact keys diagnosis, treatment, dischargeInstructions. Keep treatment concise and dischargeInstructions patient-safe. Use the text only; if missing, use a reasonable clinical default based on context.\n\nTEXT:\n' + raw_text)
    try:
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={'model': 'openai/gpt-oss-20b', 'temperature': 0.2, 'messages': [{'role': 'system', 'content': 'Return valid JSON only.'}, {'role': 'user', 'content': prompt}]},
            timeout=60
        )
        response.raise_for_status()
        content = response.json()['choices'][0]['message']['content'].replace('```json', '').replace('```', '').strip()
        result = json.loads(content)
        parsed['diagnosis'] = result.get('diagnosis') or parsed.get('diagnosis', '')
        parsed['treatment'] = result.get('treatment') or parsed.get('treatment', '')
        parsed['dischargeInstructions'] = result.get('dischargeInstructions') or parsed.get('dischargeInstructions', '')
    except (requests.RequestException, KeyError, json.JSONDecodeError):
        pass
    return parsed


def parse_medicines(raw_text):
    medicines = []
    for line in str(raw_text or '').splitlines():
        line = clean_value(line)
        if len(line) < 4 or re.match(r'^(patient|name|age|diagnosis|tests?|admission|treatment|discharge|follow)', line, re.I):
            continue
        dose = re.search(r'\b\d+(?:\.\d+)?\s*(?:mg|gm|iu|ml|%)\b', line, re.I)
        frequency = re.search(r'\b(?:\d+[-/]\d+[-/]\d+|\d+\s*(?:times|daily|hourly)|bd|od|tds|qid)\b', line, re.I)
        duration = re.search(r'\b\d+\s*(?:days?|weeks?|months?|d|w|m)\b', line, re.I)
        name = re.split(r'\s+(?:\d+(?:\.\d+)?\s*(?:mg|gm|iu|ml|%)|\d+[-/]\d+[-/]\d+|bd|od|tds|qid)\b', line, maxsplit=1, flags=re.I)[0].strip(' -')
        if name and re.search(r'[A-Za-z]{3,}', name) and len(name.split()) <= 8:
            item = {'name': name, 'dosage': dose.group(0) if dose else '', 'frequency': frequency.group(0) if frequency else '', 'duration': duration.group(0) if duration else '', 'confidence': 0.85}
            if not any(existing['name'].lower() == name.lower() for existing in medicines):
                medicines.append(item)
    return medicines


def extract_document(file_path):
    try:
        raw_text = run_google_vision(file_path) or run_local_ocr(file_path)
    except Exception:
        raw_text = run_local_ocr(file_path)
    parsed = parse_discharge_text(raw_text)
    parsed.update({
        'medicines': parse_medicines(raw_text),
        'doctor': 'Not found',
        'clinicName': 'Not found',
        'date': parsed.get('admissionDate') or datetime.now().strftime('%Y-%m-%d'),
        'rawText': raw_text
    })
    parsed = enrich_summary(raw_text, parsed)
    medicine_count = len(parsed['medicines'])
    confidence = round(sum(item.get('confidence', 0.8) for item in parsed['medicines']) / medicine_count * 100) if medicine_count else 70
    return raw_text, parsed, confidence


def save_upload(file):
    if not file or not file.filename:
        raise ValueError('No file uploaded')
    extension = Path(file.filename).suffix.lower().lstrip('.')
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError('Invalid file type. Please upload JPG, JPEG, PNG, or WEBP.')
    filename = f'{uuid.uuid4()}.{extension}'
    path = UPLOAD_DIR / secure_filename(filename)
    file.save(path)
    return path, file.filename


def process_ocr_upload(file, discharge_id=None):
    path, original_name = save_upload(file)
    try:
        raw_text, parsed, confidence = extract_document(path)
        if discharge_id:
            if not discharge_bundle(discharge_id):
                raise LookupError('Discharge not found')
            prescription_id = str(uuid.uuid4())
            get_db().execute('''INSERT INTO prescriptions (id, dischargeId, filename, originalUrl, rawText, medicines, doctor, clinicName, prescriptionDate, confidence, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (prescription_id, discharge_id, original_name, f'/uploads/prescriptions/{path.name}', raw_text, json.dumps(parsed['medicines']), parsed.get('doctor'), parsed.get('clinicName'), parsed.get('date'), confidence, 'Pending'))
            get_db().commit()
            return {'id': prescription_id, 'filename': original_name, 'rawText': raw_text, 'parsedData': parsed, 'confidence': confidence}
        return {'id': str(uuid.uuid4()), 'rawText': raw_text, 'parsedData': parsed, 'confidence': confidence}
    finally:
        path.unlink(missing_ok=True)


@app.post('/api/ocr/extract-preview')
@auth_required
def extract_preview():
    try:
        result = process_ocr_upload(request.files.get('prescription'))
        return jsonify(success=True, rawText=result['rawText'], parsedData=result['parsedData'], confidence=result['confidence'])
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(str(exc), 400)


@app.post('/api/ocr/extract')
@auth_required
def extract_ocr():
    try:
        result = process_ocr_upload(request.files.get('prescription'), request.form.get('dischargeId'))
        return jsonify(success=True, prescription=result)
    except ValueError as exc:
        return error(str(exc))
    except LookupError as exc:
        return error(str(exc), 404)
    except Exception as exc:
        return error(str(exc), 400)


@app.post('/api/ocr/verify')
@auth_required
def verify_ocr():
    data = request.get_json(silent=True) or {}
    verified = data.get('verifiedData', {}).get('medicines')
    if not data.get('prescriptionId') or not isinstance(verified, list):
        return error('Prescription ID and medicines are required')
    result = get_db().execute("UPDATE prescriptions SET status = 'Verified', medicines = ?, verifiedById = ? WHERE id = ?", (json.dumps(verified), g.user['id'], data['prescriptionId']))
    get_db().commit()
    if not result.rowcount:
        return error('Prescription not found', 404)
    return jsonify(success=True, message='Prescription verified')


@app.get('/api/ocr/history/<discharge_id>')
@auth_required
def ocr_history(discharge_id):
    rows = get_db().execute('SELECT * FROM prescriptions WHERE dischargeId = ?', (discharge_id,)).fetchall()
    return jsonify(success=True, prescriptions=[prescription_data(row) for row in rows])


def build_qr_text(discharge, patient, prescriptions):
    medicines = [medicine for prescription in prescriptions for medicine in prescription.get('medicines', [])]
    medicine_text = '; '.join(' '.join(str(item.get(key, '')).strip() for key in ('name', 'dosage', 'frequency', 'duration') if item.get(key)) for item in medicines) or 'None listed'
    def value(item):
        return re.sub(r'\s+', ' ', str(item or 'Not provided')).strip()
    return '\n'.join([
        HOSPITAL_NAME, 'DIGITAL DISCHARGE SUMMARY',
        f'Discharge ID: {value(discharge["dischargeId"])}', f'Status: {value(discharge["status"])}', '',
        f'Patient: {value(patient["name"])}', f'MRN: {value(patient["mrn"])}', f'Age: {value(patient["age"])}',
        f'Disease: {value(patient["disease"])}', f'Tests: {value(patient["testDetails"])}',
        f'Diagnosis: {value(discharge["diagnosis"])}', f'Treatment: {value(discharge["treatment"])}',
        f'Discharge instructions: {value(discharge["dischargeInstructions"])}', f'Medicines: {medicine_text}'
    ])


def qr_data_url(text):
    image = qrcode.make(text)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()


@app.get('/api/discharge/<discharge_id>/qr')
@auth_required
def get_qr(discharge_id):
    bundle = discharge_bundle(discharge_id)
    if not bundle:
        return error('Discharge not found', 404)
    discharge, patient, prescriptions = bundle
    if discharge['status'] != 'Approved':
        return error('QR code is available after approval', 409)
    qr_code = qr_data_url(build_qr_text(discharge, patient, prescriptions))
    get_db().execute('UPDATE discharges SET qrCode = ? WHERE id = ?', (qr_code, discharge_id))
    get_db().commit()
    return jsonify(success=True, qrCode=qr_code)


@app.post('/api/discharge/approve/<discharge_id>')
@auth_required
@roles('Doctor', 'Nurse', 'Admin')
def approve_discharge(discharge_id):
    bundle = discharge_bundle(discharge_id)
    if not bundle:
        return error('Discharge not found', 404)
    discharge, patient, prescriptions = bundle
    if discharge['status'] != 'Draft':
        return error('Only draft discharges can be approved', 409)
    db = get_db()
    db.execute("UPDATE discharges SET status = 'Approved', approvedById = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", (g.user['id'], discharge_id))
    db.commit()
    updated = db.execute('SELECT * FROM discharges WHERE id = ?', (discharge_id,)).fetchone()
    qr_code = qr_data_url(build_qr_text(updated, patient, prescriptions))
    db.execute('UPDATE discharges SET qrCode = ? WHERE id = ?', (qr_code, discharge_id))
    db.commit()
    return jsonify(success=True, message='Discharge approved', qrCode=qr_code)


@app.post('/api/discharge/cancel/<discharge_id>')
@auth_required
@roles('Doctor', 'Nurse', 'Admin')
def cancel_discharge(discharge_id):
    db = get_db()
    discharge = db.execute('SELECT * FROM discharges WHERE id = ?', (discharge_id,)).fetchone()
    if not discharge:
        return error('Discharge not found', 404)
    if discharge['status'] != 'Draft':
        return error('Only draft discharges can be cancelled', 409)
    db.execute("UPDATE discharges SET status = 'Cancelled', updatedAt = CURRENT_TIMESTAMP WHERE id = ?", (discharge_id,))
    db.commit()
    return jsonify(success=True, message='Discharge cancelled')


@app.get('/uploads/prescriptions/<path:filename>')
def uploaded_prescription(filename):
    return send_from_directory(UPLOAD_DIR, filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')))
