CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    voice_calibration_params TEXT,
    preferred_difficulty VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS training_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    topic VARCHAR(255),
    scene_type VARCHAR(50),
    difficulty VARCHAR(20),
    total_rounds INTEGER DEFAULT 0,
    identified_fraud BOOLEAN,
    pdf_report_path TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dialogue_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL DEFAULT 0,
    speaker VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id)
);

CREATE TABLE IF NOT EXISTS psychological_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL DEFAULT 0,
    e01_score FLOAT,
    e02_score FLOAT,
    e03_score FLOAT,
    l01_score FLOAT,
    l02_score FLOAT,
    l03_score FLOAT,
    c01_score FLOAT,
    c02_score FLOAT,
    c03_score FLOAT,
    s01_score FLOAT,
    s02_score FLOAT,
    s03_score FLOAT,
    composite_score FLOAT,
    activated_dimensions TEXT,
    feedback_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id)
);
