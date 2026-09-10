# Hospital Discharge System

## Run everything in one terminal

From the project folder:

```bash
cd /Users/sama/newone/hospital-discharge-system
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm start
```

Open `http://localhost:8000` in the browser. The API runs on `http://localhost:5000`.

Press `Ctrl+C` once to stop both servers.

## Run the Flask backend

The one-terminal launcher now starts Flask and the static frontend:

```bash
cd /Users/sama/newone/hospital-discharge-system
npm start
```

The frontend continues to use `http://localhost:5000/api`. For deployment, set the backend service root to `backend`, build command to `pip install -r requirements.txt`, and start command to `waitress-serve --host=0.0.0.0 --port=$PORT app:app`.

The legacy Node SQLite backend uses `/tmp/hospital-discharge.sqlite` on Vercel only to avoid a read-only filesystem startup error. Vercel temporary storage is not persistent, so use the Flask backend with PostgreSQL for real deployed data.

## Permanent deployment setup

Vercel serves the static frontend only. Deploy the Flask backend as a Render Docker Web Service using `render.yaml`. The root project intentionally has no Python `requirements.txt`, so Vercel does not try to deploy Flask; Python dependencies are kept in `backend/requirements.txt` for Render:

```text
Runtime: Docker
Root directory: backend
Dockerfile: backend/Dockerfile
```

After Render gives you a backend URL, set `window.HOSPITAL_API_URL` in `frontend/js/api.js` to that URL ending in `/api`, for example `https://your-service.onrender.com/api`, then push and redeploy the frontend on Vercel. Set the Flask `CORS_ORIGIN` environment variable to the Vercel frontend URL.

In the Vercel project settings, set **Root Directory** to `frontend` and redeploy. This is required because the Flask backend lives in `backend/app.py`; leaving the Vercel root as the repository root makes Vercel try to detect Python and display the entrypoint warning.
