import os
import numpy as np
from PIL import Image, ImageFilter

ISSUE_KNOWLEDGE = {
    'Pothole': {
        'keywords': ['pothole', 'road', 'crack', 'damage', 'bump', 'hole', 'asphalt', 'pavement'],
        'safety': [
            'Slow down immediately. Potholes can cause tire blowouts.',
            'Do not swerve suddenly; signal and change lanes safely.',
            'Never drive through water-covered roads - potholes may be hidden.',
            'Alert other drivers with hazard lights if stopping near one.'
        ],
        'first_aid': [
            'If a vehicle accident occurs: Call Emergency (112) immediately.',
            'Do not move injured persons unless there is immediate danger (e.g., fire).',
            'Apply pressure on bleeding wounds using a clean cloth.',
            'Keep the injured person warm and calm until help arrives.'
        ],
        'authority': 'Municipal Corporation / Roads & Bridges Dept (Helpline: 103)'
    },
    'Garbage': {
        'keywords': ['garbage', 'trash', 'waste', 'dump', 'litter', 'rubbish', 'bin', 'dirty', 'filth'],
        'safety': [
            'Avoid direct contact with waste; wear gloves if handling nearby.',
            'Keep children and pets away - waste attracts rodents and insects.',
            'Do not burn garbage - causes toxic air pollution.',
            'Wash hands thoroughly after being near waste areas.'
        ],
        'first_aid': [
            'If exposed to chemical waste: Rinse affected skin with water for 15 minutes.',
            'For eye exposure: Flush eyes with clean water immediately.',
            'If bitten by an animal near waste: Wash wound with soap/water and get rabies shot.',
            'Report suspected chemical dumping to hazmat authorities immediately.'
        ],
        'authority': 'Sanitation Department / Waste Management (Helpline: 1913)'
    },
    'Streetlight Issue': {
        'keywords': ['light', 'lamp', 'dark', 'bulb', 'street', 'pole', 'broken', 'dim', 'power'],
        'safety': [
            'Avoid walking alone in poorly lit areas, especially at night.',
            'Use a flashlight app on your phone when crossing dark stretches.',
            'Report immediately - dark roads increase accident and crime risk.',
            'Do not touch fallen electrical poles or wires.'
        ],
        'first_aid': [
            'If someone receives an electrical shock: Do NOT touch them directly.',
            'Switch off the power source if safely accessible.',
            'Call Emergency Services (112) immediately.',
            'Perform CPR only if trained and the victim is unresponsive.'
        ],
        'authority': 'Electricity Board / Municipal Street Lighting Dept (Helpline: 1912)'
    },
    'Flooding': {
        'keywords': ['flood', 'water', 'rain', 'drain', 'waterlog', 'submerged', 'overflow', 'inundation', 'storm'],
        'safety': [
            'CRITICAL: Do not walk or drive through flowing floodwater.',
            'Move to higher ground immediately if waters are rising.',
            'Stay away from electrical poles and underground cables.',
            'Boil drinking water - floodwater contaminates supplies.'
        ],
        'first_aid': [
            'If swept away: Try to float on your back, feet pointing downstream.',
            'For near-drowning: Lay person on side, clear airway, call 112.',
            'Check for hypothermia: Remove wet clothing, wrap in dry blankets.',
            'Do not give food or water to someone who was submerged.'
        ],
        'authority': 'NDRF / SDRF / Disaster Management Authority (Helpline: 1078)'
    },
    'Open Manhole': {
        'keywords': ['manhole', 'uncovered', 'sewer', 'drain cover', 'missing cover'],
        'safety': [
            'Mark the manhole with barriers or bright objects immediately.',
            'Alert other pedestrians and vehicle drivers.',
            'Keep children and animals away from the area.',
            'Do not attempt to cover it yourself - call authorities.'
        ],
        'first_aid': [
            'If someone falls in: Call 112 immediately. Do not jump in yourself.',
            'Lower a rope or belt if the person is conscious.',
            'Open manholes contain toxic gases - do not lean over.',
            'Keep the person calm and still until rescue arrives.'
        ],
        'authority': 'Municipal Corporation / Sewerage Board (Helpline: 1916)'
    },
    'Fallen Tree': {
        'keywords': ['tree', 'fallen', 'branch', 'blocking', 'uprooted', 'timber'],
        'safety': [
            'Do not attempt to move large fallen trees yourself.',
            'Alert traffic and use alternative routes.',
            'Check for downed power lines - treat all lines as live.',
            'Keep at least 10 meters distance from any fallen electrical wires.'
        ],
        'first_aid': [
            'If someone is trapped: Call 112 immediately.',
            'Do not move injured persons unless there is fire or flood risk.',
            'For crush injuries: Apply gentle pressure, keep person still.',
            'Monitor breathing and consciousness until help arrives.'
        ],
        'authority': 'Forest Department / Municipal Tree Authority (Helpline: 155210)'
    },
    'Water Leakage': {
        'keywords': ['water leakage', 'burst pipe', 'leak', 'pipe', 'spray', 'fountain', 'puddle'],
        'safety': [
            'Avoid stepping in water puddles near electrical distribution boxes.',
            'Report the leak immediately to save potable water.',
            'Do not attempt to tighten burst joints yourself.'
        ],
        'first_aid': [
            'If flooding occurs inside: Turn off the main electrical fuse.',
            'Avoid consuming standing water as it may mix with pathogens.',
            'For water force impacts: Treat as soft tissue trauma, elevate limb.'
        ],
        'authority': 'Water Supply & Water Works Dept (Helpline: 1916)'
    },
    'Sewage Overflow': {
        'keywords': ['sewage', 'overflow', 'drainage', 'foul', 'blockage', 'black water'],
        'safety': [
            'Do not walk barefoot or touch overflowed sewage pools.',
            'Sewage contains dangerous pathogens like E. Coli and Cholera.',
            'Keep doors closed to avoid toxic foul gas inhalation.'
        ],
        'first_aid': [
            'If sewage touches skin: Wash immediately with antiseptic soap.',
            'For accidental ingestion: Seek medical assistance for gastroenteritis.',
            'If eye contact occurs: Flush eyes with sterile saline for 15 mins.'
        ],
        'authority': 'Drainage & Sewerage Maintenance Board (Helpline: 1916)'
    },
    'Power Outage / Hanging Wires': {
        'keywords': ['power line', 'wire', 'outage', 'dangling', 'hanging wire', 'transformer', 'electrical'],
        'safety': [
            'Treat all hanging wires as LIVE. Stay at least 10 meters (33 feet) away.',
            'Do NOT park vehicles under dangling overhead wires.',
            'Report low-hanging cables immediately before rainfall.'
        ],
        'first_aid': [
            'If electric shock occurs: Do not touch the person directly.',
            'Use a dry, non-conductive object (wooden stick) to push the wire away.',
            'Check breathing; if absent, start chest compressions (CPR).',
            'Call Ambulance and Power Company immediately.'
        ],
        'authority': 'State Electricity Distribution Corp (Helpline: 1912)'
    },
    'Broken Traffic Signal': {
        'keywords': ['traffic light', 'traffic signal', 'broken signal', 'traffic control', 'junction'],
        'safety': [
            'Slow down when approaching intersections with broken signals.',
            'Treat the intersection as a 4-way stop sign; yield to your right.',
            'Yield to pedestrians crossing the street.'
        ],
        'first_aid': [
            'If a collision occurs: Block traffic lanes with warning triangles.',
            'Call Traffic Police (103) and Medical Emergency (112) immediately.',
            'Keep victims stable; do not remove helmets of motorcyclists.'
        ],
        'authority': 'Traffic Police Department (Helpline: 103)'
    },
    'Stray Animal Menace': {
        'keywords': ['stray dog', 'animal', 'cattle', 'dog bite', 'stray cattle', 'bovine', 'canine'],
        'safety': [
            'Do not make direct eye contact or run from aggressive stray animals.',
            'Walk slowly around cattle blocking roads; do not honk loudly.',
            'Report packs of aggressive dogs to municipal catchers.'
        ],
        'first_aid': [
            'For animal bites/scratches: Wash immediately under running water with soap for 15 mins.',
            'This washing is critical to neutralize the rabies virus.',
            'Apply antiseptic cream and rush to a hospital for anti-rabies vaccine.'
        ],
        'authority': 'Municipal Animal Husbandry & Rabies Control (Helpline: 1926)'
    },
    'Air Pollution / Open Burning': {
        'keywords': ['smoke', 'burning', 'fire', 'pollution', 'smog', 'factory', 'chemical smell'],
        'safety': [
            'Keep all windows and doors shut during high smoke density.',
            'Wear N95 masks if walking outdoors near burning areas.',
            'Do not dump combustible materials near dry leaf piles.'
        ],
        'first_aid': [
            'For smoke inhalation: Move the victim immediately to fresh air.',
            'Loosen tight clothing around neck. If breathing stops, start CPR.',
            'For eyes burning: Splash clean, cold tap water repeatedly.'
        ],
        'authority': 'State Pollution Control Board & Fire Department (Helpline: 101)'
    },
    'Illegal Parking / Road Obstruction': {
        'keywords': ['parking', 'obstruction', 'blocked road', 'illegal parking', 'towed', 'sidewalk block'],
        'safety': [
            'Do not walk on busy roadways to bypass vehicles blocking sidewalks.',
            'Report vehicles blocking emergency fire hydrants immediately.',
            'Wait for towing assistance instead of trying to move vehicles.'
        ],
        'first_aid': [
            'If a pedestrian is hit by traffic due to road obstruction: Call 112.',
            'Immobilize the affected body part. Apply pressure to stop bleeding.',
            'Keep traffic moving away from the casualty.'
        ],
        'authority': 'Traffic Control Towing Division (Helpline: 103)'
    },
    'Other': {
        'keywords': [],
        'safety': [
            'Maintain safe distance from the reported hazard zone.',
            'Document the issue from a safe angle before reporting.',
            'Alert neighboring citizens and local community watch groups.',
            'Follow standard municipal safety guidelines at all times.'
        ],
        'first_aid': [
            'Call 112 for any medical emergency.',
            'Do not panic - assess the situation before acting.',
            'Move injured persons only if immediate danger exists.',
            'Seek medical attention even for minor injuries.'
        ],
        'authority': 'Local Municipal Corporation / Civic Authority'
    }
}

def analyze_image_features(image_path):
    try:
        img = Image.open(image_path).convert('RGB')
        img_small = img.resize((150, 150))
        arr = np.array(img_small)
        r_avg = float(np.mean(arr[:, :, 0]))
        g_avg = float(np.mean(arr[:, :, 1]))
        b_avg = float(np.mean(arr[:, :, 2]))
        brightness = (r_avg + g_avg + b_avg) / 3.0
        r_std = float(np.std(arr[:, :, 0]))
        g_std = float(np.std(arr[:, :, 1]))
        b_std = float(np.std(arr[:, :, 2]))
        contrast = (r_std + g_std + b_std) / 3.0
        img_gray = img_small.convert('L')
        img_edges = img_gray.filter(ImageFilter.FIND_EDGES)
        edge_arr = np.array(img_edges)
        edge_density = float(np.mean(edge_arr)) / 255.0
        green_dom = g_avg - max(r_avg, b_avg)
        blue_dom = b_avg - max(r_avg, g_avg)
        grey_sim = 1.0 - (abs(r_avg - g_avg) + abs(g_avg - b_avg) + abs(r_avg - b_avg)) / 765.0
        dark_road = brightness < 110 and grey_sim > 0.55
        return {
            'brightness': brightness, 'contrast': contrast, 'edge_density': edge_density,
            'r': r_avg, 'g': g_avg, 'b': b_avg,
            'green_dom': green_dom, 'blue_dom': blue_dom, 'grey_sim': grey_sim, 'dark_road': dark_road
        }
    except Exception as e:
        print(f'[ML] Image analysis failed: {e}')
        return {'brightness': 127, 'contrast': 50, 'edge_density': 0.1,
                'r': 127, 'g': 127, 'b': 127, 'green_dom': 0, 'blue_dom': 0, 'grey_sim': 0.5, 'dark_road': False}

def classify_image(image_path):
    filename = os.path.basename(image_path).lower()
    features = analyze_image_features(image_path)
    print(f'[ML] Analyzing: {filename}')
    print(f'[ML] Features: brightness={features["brightness"]:.1f}, edges={features["edge_density"]:.3f}, blue={features["blue_dom"]:.1f}, green={features["green_dom"]:.1f}')
    
    category = None
    for cat, info in ISSUE_KNOWLEDGE.items():
        if cat == 'Other':
            continue
        for kw in info['keywords']:
            if kw in filename:
                category = cat
                break
        if category:
            break
            
    if not category:
        f = features
        if f['dark_road'] and f['edge_density'] > 0.10:
            category = 'Pothole'
        elif f['blue_dom'] > 20 and f['brightness'] < 155:
            category = 'Flooding'
        elif f['brightness'] < 55:
            category = 'Streetlight Issue'
        elif f['green_dom'] > 15 and f['edge_density'] > 0.14:
            category = 'Fallen Tree'
        elif f['edge_density'] > 0.17 and f['contrast'] > 55:
            category = 'Garbage'
        elif f['grey_sim'] > 0.75 and f['edge_density'] < 0.09:
            category = 'Open Manhole'
        elif f['blue_dom'] > 10 and f['brightness'] > 180:
            category = 'Water Leakage'
        elif f['brightness'] < 70 and f['edge_density'] > 0.12:
            category = 'Power Outage / Hanging Wires'
        else:
            category = 'Other'
            
    f = features
    severity_score = 0
    cat_severity = {
        'Flooding': 3, 
        'Open Manhole': 3, 
        'Sewage Overflow': 3,
        'Power Outage / Hanging Wires': 3,
        'Broken Traffic Signal': 3,
        'Garbage': 2, 
        'Pothole': 2, 
        'Fallen Tree': 2, 
        'Water Leakage': 2,
        'Stray Animal Menace': 2,
        'Air Pollution / Open Burning': 2,
        'Streetlight Issue': 1, 
        'Illegal Parking / Road Obstruction': 1,
        'Other': 1
    }
    severity_score += cat_severity.get(category, 1)
    if f['edge_density'] > 0.20:
        severity_score += 1
    if f['contrast'] > 70:
        severity_score += 1
    if f['brightness'] < 70:
        severity_score += 1
        
    if severity_score >= 5:
        severity = 'High'
    elif severity_score >= 3:
        severity = 'Medium'
    else:
        severity = 'Low'
        
    print(f'[ML] Result: category={category}, severity={severity}, score={severity_score}')
    return category, severity, ISSUE_KNOWLEDGE.get(category, ISSUE_KNOWLEDGE['Other'])
