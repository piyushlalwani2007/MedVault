// Default medical reminders (dummy data tailored for SMS alert workflow)
const DEFAULT_REMINDERS = [
	{
		id: 'rem-1',
		patientName: 'Suman Devi',
		mrn: 'MRN-84920',
		phone: '+91 98102 34567',
		testName: 'Contrast Enhanced CT Scan (Abdomen & Pelvis)',
		category: 'scans',
		categoryLabel: 'CT Scan',
		icon: '🩻',
		iconClass: 'scan',
		scheduledDate: '28 November 2026',
		scheduledTime: '10:30 AM',
		department: 'Radiology Dept, Basement Wing B',
		message: 'Suman will be notified for CT scan on 28 November via SMS alert. Fasting required 4 hours prior to scan.',
		status: 'Pending',
		channel: 'SMS Alert Scheduled'
	},
	{
		id: 'rem-2',
		patientName: 'Rahul Verma',
		mrn: 'MRN-73911',
		phone: '+91 98711 55420',
		testName: 'Fasting Blood Sugar, Lipid Profile & HbA1c Test',
		category: 'lab',
		categoryLabel: 'Pathology Lab',
		icon: '🩸',
		iconClass: 'lab',
		scheduledDate: '15 October 2026',
		scheduledTime: '08:00 AM',
		department: 'Central Clinical Pathology Lab, Ground Floor',
		message: 'Rahul Verma will be notified for Blood Sugar & HbA1c check on 15 October via SMS alert.',
		status: 'Pending',
		channel: 'SMS Alert Scheduled'
	},
	{
		id: 'rem-3',
		patientName: 'Pooja Sharma',
		mrn: 'MRN-62844',
		phone: '+91 98200 44911',
		testName: 'Post-Operative Wound Dressing & Suture Removal',
		category: 'opd',
		categoryLabel: 'Surgical Follow-up',
		icon: '🩹',
		iconClass: 'opd',
		scheduledDate: '22 October 2026',
		scheduledTime: '11:15 AM',
		department: 'General Surgery OPD, Room 14',
		message: 'Pooja Sharma will be notified for post-operative surgical dressing on 22 October via SMS alert.',
		status: 'Pending',
		channel: 'SMS Alert Scheduled'
	},
	{
		id: 'rem-4',
		patientName: 'Anil Kapoor',
		mrn: 'MRN-91823',
		phone: '+91 98990 12834',
		testName: '2D Echocardiography (Echo) & Resting ECG',
		category: 'scans',
		categoryLabel: 'Cardiology Scan',
		icon: '❤️',
		iconClass: 'echo',
		scheduledDate: '05 November 2026',
		scheduledTime: '02:00 PM',
		department: 'Cardiology Investigations Wing, 2nd Floor',
		message: 'Anil Kapoor will be notified for 2D Echo on 05 November via SMS alert.',
		status: 'Pending',
		channel: 'SMS Alert Scheduled'
	},
	{
		id: 'rem-5',
		patientName: 'Sunita Devi',
		mrn: 'MRN-55210',
		phone: '+91 97180 66231',
		testName: 'Ultrasound Whole Abdomen & KUB',
		category: 'scans',
		categoryLabel: 'Ultrasound',
		icon: '🩺',
		iconClass: 'scan',
		scheduledDate: '12 November 2026',
		scheduledTime: '09:00 AM',
		department: 'Ultrasonography Suite 3',
		message: 'Sunita Devi was notified for Ultrasound Whole Abdomen on 12 November via SMS alert.',
		status: 'Notified',
		channel: 'SMS Alert Delivered to Mobile',
		sentAt: '09:15 AM'
	}
];

let activeFilter = 'all';

function getStoredReminders() {
	try {
		const raw = localStorage.getItem('hospital_reminders_data_v2');
		if (raw) return JSON.parse(raw);
	} catch (e) {}
	localStorage.setItem('hospital_reminders_data_v2', JSON.stringify(DEFAULT_REMINDERS));
	return DEFAULT_REMINDERS;
}

function saveReminders(items) {
	localStorage.setItem('hospital_reminders_data_v2', JSON.stringify(items));
}

async function loadNotifications() {
	if (!requireAuthentication()) return;

	let apiItems = [];
	try {
		const payload = await apiRequest('/notifications/pending');
		if (payload && Array.isArray(payload.notifications)) {
			apiItems = payload.notifications.map(n => ({
				id: n.id,
				patientName: n.patientName || 'Patient',
				mrn: n.mrn || 'MRN-Auto',
				phone: n.phone || 'Registered Mobile',
				testName: n.testName || n.title || 'Clinical Investigation',
				category: 'lab',
				categoryLabel: n.type || 'Investigation',
				icon: '📋',
				iconClass: 'lab',
				scheduledDate: n.testDate || 'Upcoming',
				scheduledTime: n.testTime || '',
				department: 'Hospital Clinic',
				message: `${n.patientName || 'Patient'} will be notified for ${n.testName || 'test'} on ${n.testDate || 'scheduled date'} via SMS alert.`,
				status: 'Pending',
				channel: 'SMS Alert Scheduled'
			}));
		}
	} catch (e) {
		console.warn('API notification fallback:', e);
	}

	const stored = getStoredReminders();
	const combined = [...apiItems, ...stored.filter(s => !apiItems.some(a => a.id === s.id))];
	renderRemindersList(combined);
}

function renderRemindersList(items) {
	const container = document.querySelector('#notifications-container');
	if (!container) return;

	// Update counter badges
	const all = items;
	const scans = items.filter(i => i.category === 'scans');
	const lab = items.filter(i => i.category === 'lab');
	const opd = items.filter(i => i.category === 'opd');

	const countAll = document.getElementById('count-all');
	const countScans = document.getElementById('count-scans');
	const countLab = document.getElementById('count-lab');
	const countOpd = document.getElementById('count-opd');

	if (countAll) countAll.textContent = all.length;
	if (countScans) countScans.textContent = scans.length;
	if (countLab) countLab.textContent = lab.length;
	if (countOpd) countOpd.textContent = opd.length;

	let filtered = all;
	if (activeFilter !== 'all') {
		filtered = items.filter(i => i.category === activeFilter);
	}

	if (!filtered.length) {
		container.innerHTML = '<div class="panel" style="text-align:center;padding:40px;"><p class="muted">No reminders found in this category.</p></div>';
		return;
	}

	container.innerHTML = filtered.map(item => {
		const isSent = item.status === 'Notified';
		return `
			<article class="notif-card ${isSent ? 'completed' : ''}" id="card-${item.id}">
				<div class="notif-left">
					<div class="notif-icon ${item.iconClass || 'scan'}">${item.icon || '🔔'}</div>
					<div class="notif-body">
						<h3>
							${escapeHtml(item.patientName)}
							<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:#f0f4f3;color:#51625f;">${escapeHtml(item.mrn || '')}</span>
							<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;background:${isSent ? '#e5f3ea' : '#fbf0dd'};color:${isSent ? '#2c7a54' : '#a96a16'};">${isSent ? '✓ SMS Alert Sent' : 'Pending SMS'}</span>
						</h3>
						<p><strong>${escapeHtml(item.message)}</strong></p>
						<div class="notif-meta">
							<span>📅 <strong>${escapeHtml(item.scheduledDate)}</strong> at ${escapeHtml(item.scheduledTime)}</span>
							<span>📍 ${escapeHtml(item.department)}</span>
							<span>📱 Mobile: <strong>${escapeHtml(item.phone || 'Registered Phone')}</strong></span>
							<span>📲 Channel: <strong>${escapeHtml(item.channel || 'SMS Alert')}</strong></span>
							${item.sentAt ? `<span>🕒 Delivered at ${escapeHtml(item.sentAt)}</span>` : ''}
						</div>
					</div>
				</div>
				<div class="notif-actions">
					${isSent ? `
						<button class="btn-notified done" disabled style="opacity:0.85;cursor:default;background:#eef5f2;color:#2c7a54;border-color:#b8dbcd;">
							✓ SMS Alert Sent
						</button>
					` : `
						<button class="btn-notified" onclick="sendSmsAlert('${item.id}')" style="background:#0c5850;color:#fff;border:none;box-shadow:0 3px 10px rgba(12,88,80,0.25);">
							📲 Send SMS Alert
						</button>
					`}
				</div>
			</article>
		`;
	}).join('');
}

function filterReminders(category, btn) {
	activeFilter = category;
	document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
	if (btn) btn.classList.add('active');
	renderRemindersList(getStoredReminders());
}

// Once SMS alert is sent, it is irreversible (cannot be undone)
function sendSmsAlert(id) {
	const items = getStoredReminders();
	const item = items.find(i => i.id === id);
	if (item && item.status !== 'Notified') {
		item.status = 'Notified';
		item.channel = 'SMS Alert Delivered to Mobile';
		item.sentAt = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		saveReminders(items);
		renderRemindersList(items);
	}
}

function openNewReminderModal() {
	const modal = document.getElementById('add-modal');
	if (modal) modal.style.display = 'flex';
}

function closeModal() {
	const modal = document.getElementById('add-modal');
	if (modal) modal.style.display = 'none';
}

function addCustomReminder(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const fd = new FormData(form);

	const patientName = fd.get('patientName').trim();
	const patientPhone = fd.get('patientPhone').trim();
	const testName = fd.get('testName').trim();
	const dt = new Date(fd.get('testDateTime'));
	const department = fd.get('department').trim();
	const type = fd.get('type');

	const dateStr = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
	const timeStr = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

	const newRem = {
		id: 'rem-' + Date.now(),
		patientName,
		phone: patientPhone || 'Registered Mobile',
		mrn: `MRN-${Math.floor(10000 + Math.random() * 90000)}`,
		testName,
		category: type,
		categoryLabel: type === 'scans' ? 'Diagnostic Scan' : type === 'lab' ? 'Pathology' : 'OPD Visit',
		icon: type === 'scans' ? '🩻' : type === 'lab' ? '🩸' : '🩺',
		iconClass: type,
		scheduledDate: dateStr,
		scheduledTime: timeStr,
		department,
		message: `${patientName} will be notified for ${testName} on ${dateStr} via SMS alert.`,
		status: 'Pending',
		channel: 'SMS Alert Scheduled'
	};

	const items = getStoredReminders();
	items.unshift(newRem);
	saveReminders(items);
	closeModal();
	form.reset();
	renderRemindersList(items);
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>'"]/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
		'"': '&quot;'
	}[character]));
}
