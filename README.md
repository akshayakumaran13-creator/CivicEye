CivicEye – Galactic Community Watch and Real‑time Civic Safety Portal

Live Deployed URL:https://civiceye-nlu2.onrender.com

🌌 Overview
CivicEye is an AI‑powered safety portal and community reporting application designed to bridge the gap between citizens and local municipalities. It empowers users to report hazards, access emergency resources, and engage with civic safety through interactive features.

🚀 Core Features
Space‑Theme Landing Page  
Full‑screen cosmic design with stardust snowfall animation. Includes an interactive AI civic safety riddle game powered by Groq Llama 3.1. Correct answers trigger particle explosions and update scores.

Intelligent ML Image Analysis  
Citizens upload hazard photos. A MobileNetV2 model (ONNX Runtime) classifies hazards into 13 categories (potholes, manholes, flooding, garbage, etc.) and rates severity. Generates downloadable PDF reports with classification, coordinates, first‑aid tips, and municipal helplines.

Critical Active Watchlist  
Real‑time alerts tab where unresolved reports can be flagged. Each flag increases urgency rank in the SQLite database, keeping issues visible until resolved by administrators.

Live Hazard Map  
Uses GPS to plot citizen location on a Leaflet.js map. Scans a 3‑km radius for nearby safe zones such as hospitals, clinics, police stations, and fire services.

Groq Llama 3.1 Safety Chatbot  
Accessible via floating widget or full‑screen tab. Provides emergency procedures, answers safety questions, and drafts official reports.

Multi‑lingual Support  
Real‑time translation into English, Telugu, Tamil, Hindi, and Spanish for all interface elements, safety guides, and chatbot interactions.

⚙️ Technical Stack
Layer	Technology
Backend	Python (Flask), SQLite3
Frontend	HTML5, CSS3, JavaScript, Leaflet.js
Machine Learning	ONNX Runtime (MobileNetV2 classifier)
Language Model	Groq Cloud API (Llama‑3.1‑8b‑instant)
Hosting	Render (Docker‑based runtime)
