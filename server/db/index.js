const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/mediassist.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency & enable foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      hospital_id TEXT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      hospital_id TEXT,
      department_id TEXT,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      experience_years INTEGER NOT NULL,
      consultation_fee REAL NOT NULL,
      rating REAL DEFAULT 4.8,
      reviews_count INTEGER DEFAULT 0,
      image_url TEXT,
      languages TEXT,
      biography TEXT,
      working_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat',
      working_hours_start TEXT DEFAULT '09:00 AM',
      working_hours_end TEXT DEFAULT '05:00 PM',
      active INTEGER DEFAULT 1,
      FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS doctor_blocked_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id TEXT,
      date TEXT NOT NULL,
      reason TEXT,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK(role IN ('patient', 'doctor', 'administrator', 'frontdesk')),
      doctor_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      blood_group TEXT,
      dob TEXT,
      emergency_contact_name TEXT,
      emergency_contact_relation TEXT,
      emergency_contact_phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      patient_name TEXT NOT NULL,
      patient_email TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      hospital_id TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'checked_in', 'in_consultation')),
      type TEXT DEFAULT 'In-person',
      consultation_fee REAL,
      notes TEXT,
      booking_source TEXT DEFAULT 'web',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id),
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
    );

    -- Enforce absolute double-booking prevention: A doctor can only have 1 active appointment per date and time
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot 
    ON appointments(doctor_id, appointment_date, appointment_time) 
    WHERE status != 'cancelled';

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      appointment_id TEXT,
      event_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'email',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      error_message TEXT,
      sent_at DATETIME,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_role TEXT DEFAULT 'patient',
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  seedData();
}

function seedData() {
  const checkHospital = db.prepare('SELECT COUNT(*) as count FROM hospitals').get();
  if (checkHospital.count > 0) return;

  const insertHospital = db.prepare(`
    INSERT INTO hospitals (id, name, address, phone, email)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertHospital.run(
    'hosp-main',
    'MediAssist Medical Center',
    '128 Wellness Avenue, Medical District, NY 10021',
    '+1 (555) 123-4567',
    'care@mediassist.ai'
  );

  const insertDept = db.prepare(`
    INSERT INTO departments (id, hospital_id, name, icon, description, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const departments = [
    { id: 'cardiology', name: 'Cardiology', icon: 'heart-pulse', desc: 'Heart health, hypertension, and cardiac screening.' },
    { id: 'neurology', name: 'Neurology', icon: 'brain', desc: 'Brain, spine, and nervous system consultations.' },
    { id: 'dermatology', name: 'Dermatology', icon: 'scan-face', desc: 'Skin, hair, and allergy-related care.' },
    { id: 'orthopedics', name: 'Orthopedics', icon: 'bone', desc: 'Bones, joints, and sports injuries.' },
    { id: 'pediatrics', name: 'Pediatrics', icon: 'baby', desc: 'Infant, child, and adolescent healthcare.' },
    { id: 'general', name: 'General Medicine', icon: 'stethoscope', desc: 'Primary care, fevers, and routine checkups.' },
    { id: 'gynecology', name: 'Gynecology', icon: 'user-round', desc: "Women's reproductive health and wellness." },
    { id: 'ophthalmology', name: 'Ophthalmology', icon: 'eye', desc: 'Eye exams, vision, and ocular health.' }
  ];

  for (const dept of departments) {
    insertDept.run(dept.id, 'hosp-main', dept.name, dept.icon, dept.desc);
  }

  const insertDoctor = db.prepare(`
    INSERT INTO doctors (
      id, hospital_id, department_id, name, specialty, experience_years,
      consultation_fee, rating, reviews_count, image_url, languages, biography,
      working_days, working_hours_start, working_hours_end, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const doctors = [
    { id: 'dr-mitchell', name: 'Dr. Sarah Mitchell', specialty: 'Cardiology', deptId: 'cardiology', exp: 12, fee: 180, rating: 4.9, reviews: 214, image: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80', languages: 'English, Spanish', bio: 'Board-certified cardiologist specializing in preventive cardiology and heart failure management.' },
    { id: 'dr-wilson', name: 'Dr. James Wilson', specialty: 'Neurology', deptId: 'neurology', exp: 10, fee: 200, rating: 4.8, reviews: 178, image: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=400&q=80', languages: 'English', bio: 'Neurologist with expertise in headaches, epilepsy, and neurodegenerative disorders.' },
    { id: 'dr-carter', name: 'Dr. Emily Carter', specialty: 'Dermatology', deptId: 'dermatology', exp: 8, fee: 150, rating: 4.9, reviews: 156, image: 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=400&q=80', languages: 'English, French', bio: 'Dermatologist focused on medical dermatology, cosmetic procedures, and skin cancer screening.' },
    { id: 'dr-roberts', name: 'Dr. Michael Roberts', specialty: 'Orthopedics', deptId: 'orthopedics', exp: 15, fee: 220, rating: 4.7, reviews: 203, image: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80', languages: 'English', bio: 'Orthopedic surgeon specializing in joint replacement and sports medicine rehabilitation.' },
    { id: 'dr-sharma', name: 'Dr. Priya Sharma', specialty: 'General Medicine', deptId: 'general', exp: 9, fee: 120, rating: 4.8, reviews: 312, image: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=400&q=80', languages: 'English, Hindi', bio: 'Dedicated primary care physician with a holistic approach to chronic disease management.' },
    { id: 'dr-rao', name: 'Dr. Ananya Rao', specialty: 'Pediatrics', deptId: 'pediatrics', exp: 11, fee: 140, rating: 4.9, reviews: 267, image: 'https://images.unsplash.com/photo-1651008376811-b90baee60c1f?auto=format&fit=crop&w=400&q=80', languages: 'English, Telugu', bio: 'Pediatrician passionate about child development, vaccinations, and adolescent health.' },
    { id: 'dr-lee', name: 'Dr. Daniel Lee', specialty: 'Gynecology', deptId: 'gynecology', exp: 13, fee: 170, rating: 4.8, reviews: 189, image: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80', languages: 'English, Korean', bio: "Obstetrician-gynecologist providing compassionate women's health services." },
    { id: 'dr-patel', name: 'Dr. Aisha Patel', specialty: 'Ophthalmology', deptId: 'ophthalmology', exp: 7, fee: 160, rating: 4.8, reviews: 134, image: 'https://images.unsplash.com/photo-1643297654416-05795d62e39c?auto=format&fit=crop&w=400&q=80', languages: 'English, Gujarati', bio: 'Ophthalmologist specializing in cataract surgery and glaucoma management.' }
  ];

  for (const doc of doctors) {
    insertDoctor.run(
      doc.id, 'hosp-main', doc.deptId, doc.name, doc.specialty, doc.exp,
      doc.fee, doc.rating, doc.reviews, doc.image, doc.languages, doc.bio,
      'Mon,Tue,Wed,Thu,Fri,Sat', '09:00 AM', '05:00 PM'
    );
  }

  // Seed Users & Patients
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, phone, role, doctor_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('u-patient-1', 'Alex Johnson', 'alex.johnson@email.com', '+1 (555) 987-6543', 'patient', null);
  insertUser.run('u-doctor-1', 'Dr. Sarah Mitchell', 'sarah.mitchell@mediassist.ai', '+1 (555) 123-4567', 'doctor', 'dr-mitchell');
  insertUser.run('u-admin-1', 'Admin User', 'admin@mediassist.ai', '+1 (555) 000-1111', 'administrator', null);
  insertUser.run('u-frontdesk-1', 'FrontDesk Officer', 'frontdesk@mediassist.ai', '+1 (555) 000-2222', 'frontdesk', null);

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      id, user_id, name, email, phone, age, gender, blood_group, dob,
      emergency_contact_name, emergency_contact_relation, emergency_contact_phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPatient.run(
    'P-2026-4821', 'u-patient-1', 'Alex Johnson', 'alex.johnson@email.com', '+1 (555) 987-6543',
    34, 'Male', 'O+', '1991-03-15',
    'Jordan Johnson', 'Spouse', '+1 (555) 234-5678'
  );

  // Seed Initial Appointments matching Design Arena
  const insertAppt = db.prepare(`
    INSERT INTO appointments (
      id, patient_id, patient_name, patient_email, patient_phone,
      doctor_id, department_id, hospital_id, appointment_date, appointment_time,
      status, type, consultation_fee, notes, booking_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAppt.run(
    'MAI-2026-10482', 'P-2026-4821', 'Alex Johnson', 'alex.johnson@email.com', '+1 (555) 987-6543',
    'dr-mitchell', 'cardiology', 'hosp-main', '2026-01-28', '11:30 AM',
    'confirmed', 'In-person', 180, 'Routine cardiac checkup', 'web'
  );

  insertAppt.run(
    'MAI-2026-10456', 'P-2026-4821', 'Alex Johnson', 'alex.johnson@email.com', '+1 (555) 987-6543',
    'dr-sharma', 'general', 'hosp-main', '2026-01-15', '10:00 AM',
    'completed', 'In-person', 120, 'Fever and fatigue', 'web'
  );

  insertAppt.run(
    'MAI-2026-10389', 'P-2026-4821', 'Alex Johnson', 'alex.johnson@email.com', '+1 (555) 987-6543',
    'dr-roberts', 'orthopedics', 'hosp-main', '2025-12-10', '02:30 PM',
    'cancelled', 'In-person', 220, 'Knee pain assessment', 'web'
  );

  insertAppt.run(
    'MAI-2026-10481', null, 'Maria Garcia', 'maria.garcia@email.com', '+1 (555) 876-5432',
    'dr-wilson', 'neurology', 'hosp-main', '2026-01-28', '02:00 PM',
    'confirmed', 'In-person', 200, 'Follow-up consultation', 'frontdesk'
  );

  // Seed Blocked Dates
  const insertBlocked = db.prepare('INSERT INTO doctor_blocked_dates (doctor_id, date, reason) VALUES (?, ?, ?)');
  insertBlocked.run('dr-mitchell', '2026-02-14', 'Conference leave');
  insertBlocked.run('dr-mitchell', '2026-02-20', 'Personal leave');
}

initSchema();

module.exports = db;
