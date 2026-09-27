const db = require('../db');
const appointmentService = require('./appointmentService');
const doctorService = require('./doctorService');
const departmentService = require('./departmentService');

// Red-flag emergency indicators
const EMERGENCY_KEYWORDS = [
  'chest pain', 'heart attack', 'cannot breathe', "can't breathe", 'shortness of breath',
  'stroke', 'unconscious', 'fainted', 'heavy bleeding', 'severe bleeding',
  'overdose', 'coughing blood', 'suicide', 'anaphylaxis', 'choking'
];

class AIService {
  isEmergency(text) {
    const lower = text.toLowerCase();
    return EMERGENCY_KEYWORDS.some(k => lower.includes(k));
  }

  getOrCreateConversation(sessionId) {
    let conv = db.prepare('SELECT * FROM conversations WHERE session_id = ?').get(sessionId);
    if (!conv) {
      const id = 'conv-' + Date.now();
      db.prepare('INSERT INTO conversations (id, session_id, user_role, title) VALUES (?, ?, ?, ?)').run(
        id, sessionId, 'patient', 'New Consultation'
      );
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }
    return conv;
  }

  saveMessage(conversationId, sender, content, metadata = null) {
    db.prepare('INSERT INTO messages (conversation_id, sender, content, metadata) VALUES (?, ?, ?, ?)').run(
      conversationId, sender, content, metadata ? JSON.stringify(metadata) : null
    );
  }

  getMessages(conversationId) {
    return db.prepare('SELECT sender, content, metadata, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(conversationId);
  }

  processMessage(sessionId, userMessage) {
    const conv = this.getOrCreateConversation(sessionId);
    this.saveMessage(conv.id, 'user', userMessage);

    const text = (userMessage || '').trim();
    const lower = text.toLowerCase();

    // 1. Safety Check: Emergency triage
    if (this.isEmergency(lower)) {
      const emergencyReply = {
        isEmergency: true,
        text: 'EMERGENCY ALERT: Based on your symptoms, this could be a life-threatening medical emergency. MediAssist AI cannot diagnose or provide urgent medical intervention.\n\nPlease call emergency services (911 or your local emergency number: 108) immediately or have someone take you to the nearest Emergency Room.',
        reply: 'EMERGENCY ALERT: This could be a life-threatening emergency. Please call 911 or 108 immediately or visit the nearest Emergency Room.',
        voiceText: 'This sounds like an emergency. Please call 911 or visit the nearest emergency room immediately.',
        safetyNotice: 'MediAssist AI does not provide diagnoses. For urgent symptoms, seek immediate local emergency care.',
        actions: [
          { label: 'Call 911 / Emergency', url: 'tel:911', type: 'call' },
          { label: 'Find Nearest ER', type: 'info' }
        ]
      };

      this.saveMessage(conv.id, 'ai', emergencyReply.text, emergencyReply);
      return emergencyReply;
    }

    let reply = {
      isEmergency: false,
      text: '',
      reply: '',
      voiceText: '',
      suggestedDepartments: [],
      recommendedDoctors: [],
      slots: [],
      actions: []
    };

    // Helper functions
    const getDocs = (deptId) => doctorService.getAllDoctors({ department_id: deptId });
    const getDept = (deptId) => departmentService.getDepartmentById(deptId);

    // 2. Greetings & Salutations
    if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|hola)\b/i.test(lower) || lower === 'hi' || lower === 'hello') {
      reply.text = "Hello! Welcome to MediAssist Medical Center. I'm Sammy, your AI health concierge and appointment coordinator. How can I help you today? You can describe any symptoms you are experiencing, ask about our medical specialists, or let me know if you would like to book a consultation.";
      reply.voiceText = "Hello! I'm Sammy, your appointment assistant at MediAssist Hospital. How can I assist you with your health or booking today?";
      reply.actions = [
        { label: 'Book Appointment', action: 'navigate', view: 'booking' },
        { label: 'Explore Departments', action: 'navigate', view: 'find-doctors' },
        { label: 'Check Doctor Availability', action: 'query', text: 'Who is available today?' }
      ];
    }

    // 3. Identity, Bot Capability, & Role
    else if (/\b(who are you|what is your name|what are you|are you (an? )?ai|what can you do|tell me about yourself)\b/i.test(lower) && !lower.includes('hours') && !lower.includes('timing') && !lower.includes('doctor')) {
      reply.text = "I am Sammy, the AI frontdesk and appointment assistant for MediAssist Hospital. I can evaluate your symptoms to connect you with the appropriate medical department, introduce our clinical specialists, check appointment slots, explain consultation fees, and guide you directly through scheduling your visit.";
      reply.voiceText = "I am Sammy, your AI frontdesk assistant at MediAssist Hospital. I help you find specialists and book appointments.";
      reply.actions = [
        { label: 'Find a Specialist', action: 'navigate', view: 'find-doctors' },
        { label: 'Schedule Visit', action: 'navigate', view: 'booking' }
      ];
    }

    // 4. Pleasantries: How are you?
    else if (lower.includes('how are you') || lower.includes('how are you doing') || lower.includes("how's it going") || lower.includes("how do you do")) {
      reply.text = "I'm doing well and ready to assist you! How are you feeling today? If you have any health concerns, symptom questions, or need to see a doctor, I'm here to guide you.";
      reply.voiceText = "I'm doing great, thank you! How are you feeling today, and how can I help with your care?";
      reply.actions = [
        { label: 'I have symptoms to check', action: 'query', text: 'I have some symptoms' },
        { label: 'Book a Doctor', action: 'navigate', view: 'booking' }
      ];
    }

    // 5. Gratitude & Closing
    else if (/^(thank you|thanks|thx|thank you so much|appreciate it|great|awesome|perfect)\b/i.test(lower)) {
      reply.text = "You're very welcome! If there's anything else you need—such as checking doctor schedules, booking details, or department information—feel free to ask. Wishing you good health!";
      reply.voiceText = "You're very welcome! Let me know if you need anything else, and have a healthy day.";
      reply.actions = [
        { label: 'Book Appointment', action: 'navigate', view: 'booking' },
        { label: 'My Appointments', action: 'navigate', view: 'my-appointments' }
      ];
    } else if (/^(bye|goodbye|see you|take care|have a good day)\b/i.test(lower)) {
      reply.text = "Goodbye! Take care and have a wonderful day. MediAssist Hospital is always here whenever you need care or consultation support.";
      reply.voiceText = "Goodbye! Take care, and feel free to reach out anytime you need care.";
    }

    // 6. Hospital Location, Address, & Directions
    else if (lower.includes('location') || lower.includes('address') || lower.includes('where are you') || lower.includes('where is the hospital') || lower.includes('directions') || lower.includes('where is mediassist')) {
      reply.text = "MediAssist Medical Center is located at 128 Wellness Avenue, Medical District, NY 10021. We offer dedicated patient parking, valet assistance, and direct access from the central transit station. Would you like to schedule an in-person appointment or a telehealth consultation?";
      reply.voiceText = "MediAssist Hospital is located at 128 Wellness Avenue in the Medical District, New York. We're open for in-person and telehealth visits.";
      reply.actions = [
        { label: 'Book In-Person Visit', action: 'navigate', view: 'booking' },
        { label: 'Contact Information', action: 'query', text: 'Hospital contact details' }
      ];
    }

    // 7. Hospital Timings & Hours
    else if (lower.includes('hours') || lower.includes('timings') || lower.includes('when are you open') || lower.includes('open on sunday') || lower.includes('schedule') && lower.includes('hospital')) {
      reply.text = "Our Outpatient Specialist Clinics operate Monday through Saturday from 8:00 AM to 7:00 PM. Our 24/7 Urgent Care and Emergency Services are open continuously every day of the year.";
      reply.voiceText = "Our outpatient clinics are open Monday through Saturday from 8 AM to 7 PM, with emergency care available 24/7.";
      reply.actions = [
        { label: 'Book Appointment', action: 'navigate', view: 'booking' },
        { label: 'View Available Slots', action: 'query', text: 'Who is available today?' }
      ];
    }

    // 8. Consultation Fees & Pricing
    else if (lower.includes('fee') || lower.includes('cost') || lower.includes('price') || lower.includes('charge') || lower.includes('how much') || lower.includes('rates')) {
      reply.text = "Consultation fees at MediAssist Hospital range from $120 to $220 depending on the clinical specialty and physician experience:\n• General Medicine: $120\n• Pediatrics: $140\n• Dermatology: $150\n• Ophthalmology: $160\n• Gynecology: $170\n• Cardiology: $180\n• Neurology: $200\n• Orthopedics: $220\nAll fees are transparent with no hidden charges.";
      reply.voiceText = "Specialist consultation fees range from $120 to $220 depending on the department, with clear pricing before you confirm.";
      reply.actions = [
        { label: 'Compare Doctors & Fees', action: 'navigate', view: 'find-doctors' },
        { label: 'Book Appointment', action: 'navigate', view: 'booking' }
      ];
    }

    // 9. Insurance & Payment
    else if (lower.includes('insurance') || lower.includes('medicare') || lower.includes('medicaid') || lower.includes('cigna') || lower.includes('aetna') || lower.includes('bluecross') || lower.includes('covered')) {
      reply.text = "MediAssist Hospital accepts major commercial health insurance networks (including BlueCross BlueShield, Aetna, Cigna, UnitedHealthcare) and Medicare. We provide instant digital receipts with standard insurance diagnosis/procedure codes for seamless reimbursement.";
      reply.voiceText = "We accept most major insurance plans including Medicare, BlueCross, Aetna, and Cigna, as well as flexible self-pay.";
      reply.actions = [
        { label: 'Proceed to Booking', action: 'navigate', view: 'booking' }
      ];
    }

    // 10. Specific Doctor Inquiries
    else if (lower.includes('dr.') || lower.includes('doctor') && (lower.includes('mitchell') || lower.includes('wilson') || lower.includes('carter') || lower.includes('roberts') || lower.includes('sharma') || lower.includes('rao') || lower.includes('lee') || lower.includes('patel'))) {
      const allDocs = doctorService.getAllDoctors();
      let matched = null;
      if (lower.includes('mitchell') || lower.includes('sarah')) matched = allDocs.find(d => d.id === 'dr-mitchell');
      else if (lower.includes('wilson') || lower.includes('james')) matched = allDocs.find(d => d.id === 'dr-wilson');
      else if (lower.includes('carter') || lower.includes('emily')) matched = allDocs.find(d => d.id === 'dr-carter');
      else if (lower.includes('roberts') || lower.includes('michael')) matched = allDocs.find(d => d.id === 'dr-roberts');
      else if (lower.includes('sharma') || lower.includes('priya')) matched = allDocs.find(d => d.id === 'dr-sharma');
      else if (lower.includes('rao') || lower.includes('ananya')) matched = allDocs.find(d => d.id === 'dr-rao');
      else if (lower.includes('lee') || lower.includes('daniel')) matched = allDocs.find(d => d.id === 'dr-lee');
      else if (lower.includes('patel') || lower.includes('aisha')) matched = allDocs.find(d => d.id === 'dr-patel');

      if (matched) {
        reply.text = `${matched.name} is a leading specialist in ${matched.specialty} with ${matched.experience_years} years of clinical experience. Rating: ${matched.rating} ⭐ (${matched.reviews_count} patient reviews). Consultation fee is $${matched.consultation_fee}.\n\nBio: ${matched.bio}`;
        reply.voiceText = `${matched.name} is our specialist in ${matched.specialty} with ${matched.experience_years} years of experience and a 4.9 rating. You can book an appointment with her right away.`;
        reply.recommendedDoctors = [matched];
        reply.actions = [
          { label: `Book with ${matched.name}`, action: 'book', doctorId: matched.id },
          { label: 'View Profile', action: 'doctor-profile', doctorId: matched.id }
        ];
      }
    }

    // 11. Clinical Symptoms: Neurology
    else if (lower.includes('headache') || lower.includes('migraine') || lower.includes('dizziness') || lower.includes('vertigo') || lower.includes('seizure') || lower.includes('tremor') || lower.includes('nerve')) {
      const dept = getDept('neurology');
      const docs = getDocs('neurology');
      reply.text = "Frequent headaches, migraines, or dizziness can indicate neurological or tension factors. We recommend consulting a Neurologist or General Physician for a professional clinical evaluation.";
      reply.voiceText = "For recurring headaches or dizziness, I recommend a consultation with our Neurology specialist, Dr. James Wilson.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Neurologist'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'Explore Neurology Dept', action: 'filter', deptId: 'neurology' }
      ];
    }

    // 12. Clinical Symptoms: Dermatology
    else if (lower.includes('skin') || lower.includes('rash') || lower.includes('acne') || lower.includes('allergy') || lower.includes('eczema') || lower.includes('psoriasis') || lower.includes('itch') || lower.includes('mole')) {
      const dept = getDept('dermatology');
      const docs = getDocs('dermatology');
      reply.text = "Skin conditions, rashes, and reactions are best evaluated visually by a Dermatologist. Please avoid scratching and note down when the irritation first appeared.";
      reply.voiceText = "Skin rashes and irritations are best checked by a Dermatologist. Dr. Emily Carter is available for consultation.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Dermatologist'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'View Dermatology Specialists', action: 'filter', deptId: 'dermatology' }
      ];
    }

    // 13. Clinical Symptoms: Cardiology
    else if (lower.includes('heart') || lower.includes('cardio') || lower.includes('blood pressure') || lower.includes('palpitation') || lower.includes('hypertension') || lower.includes('cholesterol')) {
      const dept = getDept('cardiology');
      const docs = getDocs('cardiology');
      reply.text = "For cardiovascular health, blood pressure management, or routine cardiac screening, our Cardiology department provides comprehensive preventive care. (If you ever experience sudden crushing chest pain, please call emergency services immediately).";
      reply.voiceText = "For heart health and blood pressure care, our Cardiology team led by Dr. Sarah Mitchell provides comprehensive evaluation.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Cardiologist'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'View all Cardiologists', action: 'filter', deptId: 'cardiology' }
      ];
    }

    // 14. Clinical Symptoms: Orthopedics
    else if (lower.includes('bone') || lower.includes('knee') || lower.includes('joint') || lower.includes('back pain') || lower.includes('fracture') || lower.includes('shoulder') || lower.includes('spine') || lower.includes('sprain') || lower.includes('arthritis')) {
      const dept = getDept('orthopedics');
      const docs = getDocs('orthopedics');
      reply.text = "For joint pain, mobility limitations, spine issues, or sports injuries, our Orthopedic specialists can evaluate your condition, order digital imaging, and guide rehabilitation.";
      reply.voiceText = "For joint or knee pain, I recommend our Orthopedic specialist, Dr. Michael Roberts, for physical assessment and imaging.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Orthopedic Surgeon'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'View Orthopedics Dept', action: 'filter', deptId: 'orthopedics' }
      ];
    }

    // 15. Clinical Symptoms: General Medicine / Fever / Flu
    else if (lower.includes('fever') || lower.includes('cold') || lower.includes('cough') || lower.includes('checkup') || lower.includes('routine') || lower.includes('flu') || lower.includes('fatigue') || lower.includes('weakness') || lower.includes('diabetes')) {
      const dept = getDept('general');
      const docs = getDocs('general');
      reply.text = "For fevers, seasonal infections, or an annual wellness physical, a General Physician provides thorough primary evaluation and coordinates any specialized diagnostic tests.";
      reply.voiceText = "For fevers, cold symptoms, or an annual checkup, our General Physician Dr. Priya Sharma is available for comprehensive care.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Physician'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'General Medicine Dept', action: 'filter', deptId: 'general' }
      ];
    }

    // 16. Clinical Symptoms: Pediatrics
    else if (lower.includes('child') || lower.includes('baby') || lower.includes('pediatric') || lower.includes('kid') || lower.includes('infant') || lower.includes('vaccination')) {
      const dept = getDept('pediatrics');
      const docs = getDocs('pediatrics');
      reply.text = "Our Pediatrics department specializes in child growth milestones, vaccinations, seasonal illnesses, and adolescent health in a welcoming, family-friendly setting.";
      reply.voiceText = "Our Pediatrics department, led by Dr. Ananya Rao, provides compassionate care for infants, children, and teens.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Pediatrician'}`, action: 'book', doctorId: docs[0]?.id },
        { label: 'View Pediatrics Dept', action: 'filter', deptId: 'pediatrics' }
      ];
    }

    // 17. Clinical Symptoms: Gynecology & Women's Health
    else if (lower.includes('pregnant') || lower.includes('pregnancy') || lower.includes('gynecology') || lower.includes('period') || lower.includes('menstrual') || lower.includes('pcos') || lower.includes('pcod') || lower.includes('pelvic')) {
      const dept = getDept('gynecology');
      const docs = getDocs('gynecology');
      reply.text = "Our Gynecology department provides confidential, expert care for women's reproductive health, prenatal monitoring, hormonal balancing, and routine screening.";
      reply.voiceText = "For women's health and prenatal care, Dr. Daniel Lee in our Gynecology department provides expert, supportive care.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Gynecologist'}`, action: 'book', doctorId: docs[0]?.id }
      ];
    }

    // 18. Clinical Symptoms: Ophthalmology (Eyes)
    else if (lower.includes('eye') || lower.includes('vision') || lower.includes('blur') || lower.includes('glasses') || lower.includes('cataract') || lower.includes('glaucoma')) {
      const dept = getDept('ophthalmology');
      const docs = getDocs('ophthalmology');
      reply.text = "For vision changes, eye irritation, refractive testing, or cataract screening, our Ophthalmology clinic features modern diagnostic equipment for complete eye care.";
      reply.voiceText = "For vision and eye care, Dr. Aisha Patel in Ophthalmology can perform an in-depth eye exam.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: `Book with ${docs[0]?.name || 'Ophthalmologist'}`, action: 'book', doctorId: docs[0]?.id }
      ];
    }

    // 19. Clinical Symptoms: Digestive / Gastro (Stomach pain, acid reflux)
    else if (lower.includes('stomach') || lower.includes('digestive') || lower.includes('acid reflux') || lower.includes('gerd') || lower.includes('nausea') || lower.includes('vomiting') || lower.includes('constipation') || lower.includes('diarrhea') || lower.includes('abdominal')) {
      const dept = getDept('general');
      const docs = getDocs('general');
      reply.text = "Abdominal discomfort or acid reflux can stem from dietary, gastrointestinal, or digestive factors. Our General Medicine specialists can evaluate your symptoms, prescribe relief, and order ultrasound or lab screenings if necessary.";
      reply.voiceText = "For stomach pain or digestive issues, our General Physicians provide thorough primary evaluation and relief.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: 'Consult General Physician', action: 'book', doctorId: docs[0]?.id },
        { label: 'Book General Checkup', action: 'navigate', view: 'booking' }
      ];
    }

    // 20. Clinical Symptoms: ENT (Ear, Nose, Throat)
    else if (lower.includes('ear') || lower.includes('throat') || lower.includes('hearing') || lower.includes('sinus') || lower.includes('tinnitus') || lower.includes('tonsil')) {
      const dept = getDept('general');
      const docs = getDocs('general');
      reply.text = "Ear, nose, and throat symptoms like earaches, persistent sore throat, or sinus pressure can be thoroughly inspected by our primary care and ENT-affiliated physicians.";
      reply.voiceText = "For ear, nose, or throat symptoms, our physicians can examine you and provide immediate clinical guidance.";
      reply.suggestedDepartments = [dept];
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: 'Book Physician Visit', action: 'book', doctorId: docs[0]?.id }
      ];
    }

    // 21. Appointment Lookup & Management
    else if (lower.includes('appointment') && (lower.includes('status') || lower.includes('find') || lower.includes('check') || lower.includes('my') || lower.includes('reschedule') || lower.includes('cancel'))) {
      reply.text = "You can view, download, reschedule, or manage all your confirmed visits directly from your 'My Appointments' dashboard with real-time hospital database synchronization.";
      reply.voiceText = "You can view and manage all your scheduled appointments anytime in your My Appointments dashboard.";
      reply.actions = [
        { label: 'Go to My Appointments', action: 'navigate', view: 'my-appointments' },
        { label: 'Book a New Visit', action: 'navigate', view: 'booking' }
      ];
    }

    // 22. General Booking Intent
    else if (lower.includes('book') || lower.includes('schedule') || lower.includes('appointment') || lower.includes('consultation') || lower.includes('visit')) {
      reply.text = "I'd be glad to help you book an appointment! You can select a department or doctor, pick an available date and time slot with atomic conflict protection, and receive an instant email confirmation.";
      reply.voiceText = "I can help you book right away. Would you like to pick a department or choose a specific doctor?";
      reply.actions = [
        { label: 'Start Booking Flow', action: 'navigate', view: 'booking' },
        { label: 'Find a Specialist', action: 'navigate', view: 'find-doctors' }
      ];
    }

    // 23. Intelligent Conversational Fallback
    else {
      const depts = departmentService.getAllDepartments();
      const docs = doctorService.getAllDoctors();
      reply.text = `Thank you for sharing that. As your MediAssist AI assistant, I can connect you with specialized doctors across our 8 clinical departments, check appointment availability, or guide you through scheduling a consultation.

For general inquiries or undefined symptoms, our General Medicine team provides comprehensive primary evaluations. How would you like to proceed?`;
      reply.voiceText = "I'm here to help with your healthcare needs. You can ask about our medical specialists, describe your symptoms, or book an appointment.";
      reply.suggestedDepartments = depts.slice(0, 4);
      reply.recommendedDoctors = docs.slice(0, 2);
      reply.actions = [
        { label: 'Book Consultation', action: 'navigate', view: 'booking' },
        { label: 'Browse Doctors', action: 'navigate', view: 'find-doctors' },
        { label: 'General Medicine Checkup', action: 'book', doctorId: 'dr-sharma' }
      ];
    }

    reply.reply = reply.text;
    if (!reply.voiceText) reply.voiceText = reply.text.slice(0, 140);
    reply.safetyNotice = 'MediAssist AI does not provide medical diagnoses. For emergencies, contact local emergency services immediately.';

    this.saveMessage(conv.id, 'ai', reply.text, reply);
    return reply;
  }
}

module.exports = new AIService();
