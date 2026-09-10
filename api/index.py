import sys
from pathlib import Path

project_root = Path(__file__).resolve().parents[1]
backend_dir = project_root / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app import app

# Vercel discovers the Flask WSGI application from this module.
