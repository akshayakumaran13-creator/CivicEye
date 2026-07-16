import os
import json
import urllib.request
import urllib.error
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename
import config
import db
from ml_classifier import classify_image

# Self-healing path resolver: recursively search for templates, static assets, and translations
base_dir = os.path.dirname(os.path.abspath(__file__))

# Print directory structure for Render debugging
print("=== DEPLOYED DIRECTORY TREE ===")
for root, dirs, files in os.walk(base_dir):
    print(f"Dir: {root}")
    for f in files:
        print(f"  File: {f}")
print("===============================")

template_dir = 'templates'
for root, dirs, files in os.walk(base_dir):
    if 'index.html' in files:
        template_dir = os.path.relpath(root, base_dir)
        break

static_dir = 'static'
static_url = '/static'
for root, dirs, files in os.walk(base_dir):
    if 'style.css' in files:
        static_dir = os.path.relpath(root, base_dir)
        break

translations_dir = 'translations'
for root, dirs, files in os.walk(base_dir):
    if 'en.json' in files:
        translations_dir = os.path.relpath(root, base_dir)
        break

app = Flask(__name__, root_path=base_dir, template_folder=template_dir, static_folder=static_dir, static_url_path=static_url)
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER

db.init_db()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/debug-files')
def debug_files():
    tree = {}
    for root, dirs, files in os.walk(base_dir):
        rel_root = os.path.relpath(root, base_dir)
        tree[rel_root] = files
    return jsonify({
        'base_dir': base_dir,
        'template_folder': app.template_folder,
        'static_folder': app.static_folder,
        'root_path': app.root_path,
        'tree': tree
    })

@app.route('/lang/<code>')
def get_language(code):
    if code not in config.SUPPORTED_LANGUAGES:
        code = 'en'
    return send_from_directory(translations_dir, f'{code}.json')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/stats')
def get_stats():
    try:
        return jsonify(db.get_stats())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/reports-list')
def reports_list():
    status = request.args.get('status')
    try:
        reports = db.get_all_reports(status_filter=status)
        return jsonify(reports)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/active-alerts')
def active_alerts():
    try:
        reports = db.get_active_reports()
        return jsonify(reports)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

GUIDELINES_CACHE = {}

def translate_knowledge(knowledge, lang):
    if lang == 'en' or not config.GROQ_API_KEY:
        return knowledge
    try:
        lang_names = {'en': 'English', 'te': 'Telugu', 'ta': 'Tamil', 'hi': 'Hindi', 'es': 'Spanish'}
        target_lang = lang_names.get(lang, 'English')
        
        system_prompt = (
            f"You are a translation assistant. Translate the following civic hazard safety info into {target_lang}. "
            "Respond ONLY with a valid JSON object matching this schema:\n"
            "{\n"
            '  "safety": ["Tip 1", "Tip 2", ...],\n'
            '  "first_aid": ["Aid 1", "Aid 2", ...],\n'
            '  "authority": "Authority contact info"\n'
            "}\n"
            "Do not include markdown codeblocks or extra text. Retain any numbers or helpline codes as is."
        )
        
        payload = {
            'model': 'llama-3.1-8b-instant',
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': json.dumps(knowledge)}
            ],
            'temperature': 0.1,
            'max_tokens': 500
        }
        
        req_data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            'https://api.groq.com/openai/v1/chat/completions',
            data=req_data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {config.GROQ_API_KEY}',
                'User-Agent': 'Mozilla/5.0'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            resp_data = json.loads(response.read().decode('utf-8'))
            raw_content = resp_data['choices'][0]['message']['content'].strip()
            
            if raw_content.startswith('```'):
                lines = raw_content.split('\n')
                if lines[0].startswith('```json') or lines[0].startswith('```'):
                    raw_content = '\n'.join(lines[1:-1]).strip()
            
            translated = json.loads(raw_content)
            if 'safety' in translated and 'first_aid' in translated and 'authority' in translated:
                return translated
    except Exception as e:
        print(f"[Translator] Error translating report knowledge: {e}")
    return knowledge

def get_translated_guidelines(lang):
    if lang == 'en' or not config.GROQ_API_KEY:
        from ml_classifier import ISSUE_KNOWLEDGE
        return ISSUE_KNOWLEDGE
    if lang in GUIDELINES_CACHE:
        return GUIDELINES_CACHE[lang]
        
    from ml_classifier import ISSUE_KNOWLEDGE
    translated_book = {}
    lang_names = {'en': 'English', 'te': 'Telugu', 'ta': 'Tamil', 'hi': 'Hindi', 'es': 'Spanish'}
    target_lang = lang_names.get(lang, 'English')
    
    print(f"[Guidelines] Translating guidebook into {target_lang}...")
    for category, content in ISSUE_KNOWLEDGE.items():
        input_data = {
            'safety': content['safety'],
            'first_aid': content['first_aid'],
            'authority': content['authority']
        }
        translated_content = translate_knowledge(input_data, lang)
        translated_book[category] = {
            'keywords': content.get('keywords', []),
            'safety': translated_content['safety'],
            'first_aid': translated_content['first_aid'],
            'authority': translated_content['authority']
        }
    GUIDELINES_CACHE[lang] = translated_book
    return translated_book

@app.route('/report', methods=['POST'])
def report_issue():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    file = request.files['image']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400
    if not config.allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    latitude = request.form.get('latitude', '')
    longitude = request.form.get('longitude', '')
    place_name = request.form.get('place_name', 'Unknown Location')
    language = request.form.get('language', 'en')
    if language not in config.SUPPORTED_LANGUAGES:
        language = 'en'
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    try:
        category, severity, knowledge = classify_image(filepath)
        
        # Translate dynamic safety guidebook tips if language is not English
        if language != 'en':
            knowledge = translate_knowledge(knowledge, language)
            
        report_id = db.add_report(
            filename=filename, category=category, severity=severity,
            latitude=latitude, longitude=longitude,
            place_name=place_name, language=language
        )
        return jsonify({
            'id': report_id, 'filename': filename, 'category': category,
            'severity': severity, 'place_name': place_name,
            'latitude': latitude, 'longitude': longitude,
            'safety_tips': knowledge['safety'],
            'first_aid': knowledge['first_aid'],
            'authority': knowledge['authority']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/resolve/<int:report_id>', methods=['POST'])
def resolve_report(report_id):
    try:
        db.update_report_status(report_id, 'Resolved')
        return jsonify({'success': True, 'id': report_id, 'status': 'Resolved'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/flag-report/<int:report_id>', methods=['POST'])
def flag_report(report_id):
    try:
        new_count = db.increment_report_flags(report_id)
        return jsonify({'success': True, 'id': report_id, 'flags_count': new_count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/admin-dashboard')
def admin_dashboard():
    return render_template('admin.html')

@app.route('/guidelines')
def get_guidelines():
    lang = request.args.get('lang', 'en')
    if lang not in config.SUPPORTED_LANGUAGES:
        lang = 'en'
    try:
        data = get_translated_guidelines(lang)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat_assistant():
    try:
        data = request.json or {}
        user_message = data.get('message', '')
        user_key = data.get('api_key', '').strip()
        history = data.get('history', [])
        language = data.get('language', 'en')
        
        # Determine active key (use provided key or default key)
        api_key = user_key if user_key else config.GROQ_API_KEY
        if not api_key:
            return jsonify({'error': 'Groq API Key is missing. Please configure it in chat settings.'}), 400
            
        # Build prompt messages
        lang_names = {'en': 'English', 'te': 'Telugu', 'ta': 'Tamil', 'hi': 'Hindi', 'es': 'Spanish'}
        target_lang = lang_names.get(language, 'English')
        
        system_prompt = (
            "You are CivicEye AI, a professional civic safety and emergency response assistant. "
            "Your purpose is to help citizens report municipal hazards, understand safety measures, "
            "and learn critical first-aid guidelines.\n\n"
            "We support the following 13 civic issue categories:\n"
            "1. Potholes, 2. Garbage, 3. Streetlight Issues, 4. Flooding, 5. Open Manholes, "
            "6. Fallen Trees, 7. Water Leakages, 8. Sewage Overflow, 9. Power Outages/Hanging Wires, "
            "10. Broken Traffic Signals, 11. Stray Animal Menace, 12. Air Pollution/Open Burning, "
            "13. Illegal Parking/Obstructions.\n\n"
            "Provide helpful, concise, and structured instructions. If a user describes an emergency "
            "(like electric shock, gas inhalation, animal bite, or vehicle crash), immediately provide "
            "the corresponding first aid guidelines first, and list the target helpline number.\n\n"
            f"CRITICAL: You MUST write your response entirely in {target_lang}."
        )
        
        messages = [{'role': 'system', 'content': system_prompt}]
        for msg in history:
            messages.append({'role': msg.get('role', 'user'), 'content': msg.get('content', '')})
        messages.append({'role': 'user', 'content': user_message})
        
        # Prepare request payload
        payload = {
            'model': 'llama-3.1-8b-instant',
            'messages': messages,
            'temperature': 0.7,
            'max_tokens': 800
        }
        
        req_data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            'https://api.groq.com/openai/v1/chat/completions',
            data=req_data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
                'User-Agent': 'Mozilla/5.0'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=12) as response:
            resp_data = json.loads(response.read().decode('utf-8'))
            reply = resp_data['choices'][0]['message']['content']
            return jsonify({'reply': reply})
            
    except urllib.error.HTTPError as he:
        try:
            err_resp = json.loads(he.read().decode('utf-8'))
            err_msg = err_resp.get('error', {}).get('message', he.reason)
        except:
            err_msg = he.reason
        return jsonify({'error': f'Groq API Error: {err_msg}'}), he.code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/generate-riddle', methods=['GET'])
def generate_riddle():
    try:
        api_key = config.GROQ_API_KEY
        if not api_key:
            raise ValueError('Groq key not configured.')
            
        system_prompt = (
            "You are a funny and creative JSON generator. "
            "You MUST generate a single riddle related to civic/municipal safety issues, road hazards, "
            "or emergency procedures (e.g. open manholes, potholes, flooding, garbage, broken streetlights, "
            "fallen trees, hanging wires, stray animals, or fire safety).\n\n"
            "Respond ONLY with a valid JSON object matching this exact schema:\n"
            "{\n"
            '  "question": "The riddle question...",\n'
            '  "choices": ["Option A", "Option B", "Option C"],\n'
            '  "correct": 0,\n'
            '  "hint": "A short, helpful safety tip related to the correct answer..."\n'
            "}\n"
            "Do not include any wrapper tags, backticks, or markdown formatting in your response. "
            "Only output the raw JSON string."
        )
        
        payload = {
            'model': 'llama-3.1-8b-instant',
            'messages': [{'role': 'user', 'content': system_prompt}],
            'temperature': 0.85,
            'max_tokens': 350
        }
        
        req_data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            'https://api.groq.com/openai/v1/chat/completions',
            data=req_data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
                'User-Agent': 'Mozilla/5.0'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=12) as response:
            resp_data = json.loads(response.read().decode('utf-8'))
            raw_content = resp_data['choices'][0]['message']['content'].strip()
            
            if raw_content.startswith('```'):
                lines = raw_content.split('\n')
                if lines[0].startswith('```json') or lines[0].startswith('```'):
                    raw_content = '\n'.join(lines[1:-1]).strip()
            
            riddle_json = json.loads(raw_content)
            if 'question' in riddle_json and 'choices' in riddle_json and 'correct' in riddle_json:
                return jsonify(riddle_json)
            else:
                raise ValueError("Generated JSON missing required fields.")
                
    except Exception as e:
        print(f"[Riddle Generator] Fallback due to error: {e}")
        import random
        local_fallbacks = [
            {
                "question": "I am a pool of water that blocks traffic, but I have no fish or sandy beaches. What am I?",
                "choices": ["A Pond", "Flooding", "A Puddle"],
                "correct": 1,
                "hint": "Never drive or walk through flooded roadways! High water hides potholes."
            },
            {
                "question": "I carry dark runoff underground. If my metal cover is missing, I am a trap. What am I?",
                "choices": ["A Tunnel", "An Open Manhole", "A Drain Pipe"],
                "correct": 1,
                "hint": "Open manholes contain toxic gases. Mark with warning flags immediately."
            },
            {
                "question": "I glow in the dark corridors of the night. If I break, shadows rule. What am I?",
                "choices": ["A Firefly", "A Streetlight", "A Spotlight"],
                "correct": 1,
                "hint": "Streetlights reduce traffic crashes and night-time crime hazards."
            },
            {
                "question": "I am a crack on the road that devours tires. What am I?",
                "choices": ["A Dirt Road", "A Pothole", "A Speed Bump"],
                "correct": 1,
                "hint": "Potholes cause sudden swerves. Slow down to prevent tyre blowouts."
            }
        ]
        return jsonify(random.choice(local_fallbacks))

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
