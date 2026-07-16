import os

# Base directory of the project
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Folder to store uploaded images
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# SQLite database file path
DATABASE_PATH = os.path.join(BASE_DIR, 'reports.db')

# Supported language codes
SUPPORTED_LANGUAGES = ['en', 'ta', 'te', 'hi', 'es']

# Admin password for dashboard (demo only)
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'Aksh0308')

# Groq API Key for AI Chatbot
GROQ_API_KEY = os.getenv('GROQ_API_KEY')

# Fallback: check if local .env exists (never committed to Git)
if not GROQ_API_KEY:
    dot_env_path = os.path.join(BASE_DIR, '.env')
    if os.path.exists(dot_env_path):
        try:
            with open(dot_env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('GROQ_API_KEY='):
                        GROQ_API_KEY = line.split('=', 1)[1].strip('"').strip("'")
                        break
        except Exception as e:
            print(f"[Config] Error reading .env: {e}")

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'jfif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
