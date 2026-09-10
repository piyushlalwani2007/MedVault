import sys
from pathlib import Path
from urllib.parse import parse_qs

project_root = Path(__file__).resolve().parents[1]
backend_dir = project_root / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app import app as flask_app


def vercel_path_compatibility(environ, start_response):
    """Restore the original API path after Vercel rewrites to this function."""
    if environ.get('PATH_INFO') in ('/api/index.py', '/api'):
        original_path = parse_qs(environ.get('QUERY_STRING', '')).get('path', [None])[0]
        original_path = original_path or environ.get('HTTP_X_VERCEL_ORIGINAL_PATH') or environ.get('HTTP_X_ORIGINAL_URL')
        if original_path and original_path.startswith('/api/'):
            environ['PATH_INFO'] = original_path.split('?', 1)[0]
    return flask_app(environ, start_response)


# Vercel discovers this WSGI-compatible callable from the module.
handler = vercel_path_compatibility
app = handler
