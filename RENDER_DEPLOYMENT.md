# Truth Lens — Render deployment

## Architecture
- Render: Flask/Gunicorn application, ML model, OCR, frontend
- Firebase: authentication / Firestore as configured by the app

## Deploy
1. Push this project to a **private GitHub repository**.
2. In Render, create **New -> Web Service** and connect the repository.
3. Select **Docker**. Render will use `Dockerfile`.
4. Choose the **Free** plan.
5. Add any required Firebase/application secrets under Render -> Environment.
6. Deploy.

## Important
- `.env` files are excluded from Git.
- Training CSV files are excluded from the deployment package because the runtime uses the trained `.pkl` model/vectorizer.
- The frontend API calls were changed away from `127.0.0.1:5000`/`localhost:5000` so they work on the deployed origin.
