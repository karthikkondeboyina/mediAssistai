const assert = require('assert');
const path = require('path');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(__dirname, '../data/mediassist_test.db');
process.env.TEST_EMAIL_RECIPIENT = 'karthikkondeboyina@gmail.com';
process.env.SIMULATE_EMAIL_DELIVERY = 'true';

const db = require('../server/db');
const appointmentService = require('../server/services/appointmentService');
const notificationService = require('../server/services/notificationService');
const doctorService = require('../server/services/doctorService');
const aiService = require('../server/services/aiService');

async function runTests() {
  console.log('====================================================');
  console.log(' Starting MediAssist AI Verification Test Suite');
  console.log('====================================================\n');

  // Clean up any previous test appointments to ensure test isolation
  db.exec(`
    DELETE FROM notifications WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '2026-03-01');
    DELETE FROM appointments WHERE appointment_date >= '2026-03-01';
  `);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• ${name}... `);
      await fn();
      console.log('PASSED ✓');
      passed++;
    } catch (err) {
      console.log('FAILED ✗');
      console.error('  Error:', err.message);
      if (err.stack) console.error('  Stack:', err.stack);
      failed++;
    }
  }

  // TEST 1: Successful Booking
  await test('Test 1: Successful Booking with Atomic Unique ID & Notification', async () => {
    const testDate = '2026-03-10';
    const testTime = '09:30 AM';
    const docId = 'dr-mitchell';

    const appt = appointmentService.createAppointment({
      patient_name: 'Alex Johnson',
      patient_email: 'alex.johnson@email.com',
      patient_phone: '+1 (555) 987-6543',
      doctor_id: docId,
      department_id: 'cardiology',
      appointment_date: testDate,
      appointment_time: testTime,
      type: 'In-person',
      notes: 'Initial cardiac evaluation'
    });

    assert(appt, 'Appointment was not returned');
    assert(appt.id.startsWith('MAI-2026-'), `Appointment ID ${appt.id} does not match format MAI-2026-XXXXX`);
    assert.strictEqual(appt.status, 'confirmed', 'Appointment status is not confirmed');
    assert.strictEqual(appt.doctor_id, docId);
    assert.strictEqual(appt.appointment_date, testDate);
    assert.strictEqual(appt.appointment_time, testTime);

    // Verify Notification Record matches patient's registered email
    const notifs = notificationService.getNotificationsForAppointment(appt.id);
    assert(notifs.length > 0, 'Notification event was not created');
    assert.strictEqual(notifs[0].event_type, 'appointment.created');
    assert.strictEqual(notifs[0].recipient_email, 'alex.johnson@email.com', 'Recipient should be the patient\'s registered email');
  });

  // TEST 2: Duplicate Booking Rejection
  await test('Test 2: Duplicate Booking Rejection (Database-level Slot Conflict)', async () => {
    const testDate = '2026-03-10';
    const testTime = '09:30 AM';
    const docId = 'dr-mitchell';

    let errorThrown = null;
    try {
      appointmentService.createAppointment({
        patient_name: 'Another Patient',
        patient_email: 'another@patient.com',
        patient_phone: '+1 (555) 111-2222',
        doctor_id: docId,
        department_id: 'cardiology',
        appointment_date: testDate,
        appointment_time: testTime
      });
    } catch (err) {
      errorThrown = err;
    }

    assert(errorThrown, 'Expected duplicate booking to throw an error, but it succeeded');
    assert.strictEqual(errorThrown.statusCode, 409, `Expected HTTP 409, got ${errorThrown.statusCode}`);
    assert(errorThrown.message.includes('already booked'), 'Error message should mention already booked');

    // Verify that the occupied slot is now reported as unavailable in doctor availability query
    const availability = appointmentService.getDoctorAvailability(docId, testDate);
    const slot = availability.slots.find(s => s.time === testTime);
    assert(slot, 'Slot not found in doctor availability');
    assert.strictEqual(slot.available, false, 'Occupied slot should be reported as unavailable');
  });

  // TEST 3: Appointment Cancellation & Slot Release
  await test('Test 3: Appointment Cancellation & Slot Release', async () => {
    const testDate = '2026-03-16'; // Monday
    const testTime = '10:00 AM';
    const docId = 'dr-wilson';

    // Book first
    const appt = appointmentService.createAppointment({
      patient_name: 'Alex Johnson',
      patient_email: 'alex.johnson@email.com',
      patient_phone: '+1 (555) 987-6543',
      doctor_id: docId,
      department_id: 'neurology',
      appointment_date: testDate,
      appointment_time: testTime
    });

    // Cancel
    const cancelled = appointmentService.cancelAppointment(appt.id, 'Patient requested');
    assert.strictEqual(cancelled.status, 'cancelled');

    // Verify slot is now free again
    const availability = appointmentService.getDoctorAvailability(docId, testDate);
    const slot = availability.slots.find(s => s.time === testTime);
    assert.strictEqual(slot.available, true, 'Slot must be released after appointment cancellation');

    // Now another patient should be able to book this released slot without conflict
    const newAppt = appointmentService.createAppointment({
      patient_name: 'Patient Two',
      patient_email: 'patient2@test.com',
      patient_phone: '+1 (555) 333-4444',
      doctor_id: docId,
      department_id: 'neurology',
      appointment_date: testDate,
      appointment_time: testTime
    });
    assert(newAppt.id, 'Booking into freed slot must succeed');
  });

  // TEST 4: Appointment Rescheduling
  await test('Test 4: Appointment Rescheduling to New Slot', async () => {
    const origDate = '2026-03-20';
    const origTime = '02:00 PM';
    const newDate = '2026-03-20';
    const newTime = '03:00 PM';
    const docId = 'dr-carter';

    const appt = appointmentService.createAppointment({
      patient_name: 'Alex Johnson',
      patient_email: 'alex.johnson@email.com',
      patient_phone: '+1 (555) 987-6543',
      doctor_id: docId,
      department_id: 'dermatology',
      appointment_date: origDate,
      appointment_time: origTime
    });

    const rescheduled = appointmentService.rescheduleAppointment(appt.id, newDate, newTime);
    assert.strictEqual(rescheduled.status, 'rescheduled');
    assert.strictEqual(rescheduled.appointment_date, newDate);
    assert.strictEqual(rescheduled.appointment_time, newTime);

    // Old slot is freed
    const avail = appointmentService.getDoctorAvailability(docId, origDate);
    const oldSlot = avail.slots.find(s => s.time === origTime);
    assert.strictEqual(oldSlot.available, true, 'Old slot must be freed after rescheduling');
  });

  // TEST 5: Email Notification Failure Resilience
  await test('Test 5: Email Notification Failure Resilience (Preserves Appointment State)', async () => {
    const testDate = '2026-03-25';
    const testTime = '11:00 AM';
    const docId = 'dr-sharma';

    // Temporarily set simulation to false to trigger provider failure
    process.env.SIMULATE_EMAIL_DELIVERY = 'false';

    const appt = appointmentService.createAppointment({
      patient_name: 'Test Patient',
      patient_email: 'karthikkondeboyina@gmail.com',
      patient_phone: '+1 (555) 999-8888',
      doctor_id: docId,
      department_id: 'general',
      appointment_date: testDate,
      appointment_time: testTime
    });

    // Appointment record in DB must be valid and confirmed
    assert(appt, 'Appointment must be preserved');
    assert.strictEqual(appt.status, 'confirmed', 'Appointment status must remain confirmed');

    // Wait brief tick for async event handler
    await new Promise(r => setTimeout(r, 100));

    // Notification status in DB must reflect failure
    const notifs = notificationService.getNotificationsForAppointment(appt.id);
    assert(notifs.length > 0, 'Notification record should exist');
    assert.strictEqual(notifs[0].status, 'failed', 'Notification status should be failed when SMTP not configured');
    assert(notifs[0].error_message, 'Error message should be logged');

    // Reset simulation
    process.env.SIMULATE_EMAIL_DELIVERY = 'true';
  });

  // TEST 6: AI Assistant Emergency Triage & Department Routing
  await test('Test 6: AI Assistant Emergency Triage & Department Routing', async () => {
    // Sub-case A: Emergency detection
    const emergencyReply = aiService.processMessage('emergency-test-session', 'I am having crushing chest pain and cannot breathe');
    assert.strictEqual(emergencyReply.isEmergency, true, 'AI must detect life-threatening emergency');
    assert(emergencyReply.text.includes('EMERGENCY ALERT'), 'AI response must contain emergency warning');
    assert(emergencyReply.text.includes('911'), 'AI response must direct to emergency services');

    // Sub-case B: Clinical department recommendation
    const normalReply = aiService.processMessage('normal-test-session', 'I have a recurring skin rash with redness');
    assert.strictEqual(normalReply.isEmergency, false);
    assert(normalReply.text.includes('Dermatologist'), 'AI should recommend a Dermatologist for skin rash');
    assert(normalReply.recommendedDoctors.length > 0, 'AI should recommend specialist doctors');
  });

  // TEST 7: Role-Based Authorization Enforcement
  await test('Test 7: Role-Based Authorization (Patients barred from Admin/FrontDesk ops)', async () => {
    const { authenticate, requireRole } = require('../server/middleware/auth');

    // Mock request with Patient role attempting Admin operation
    let patientForbidden = false;
    const reqPatient = { headers: { 'x-user-role': 'patient' } };
    const resForbidden = {
      status: (code) => {
        if (code === 403) patientForbidden = true;
        return { json: () => {} };
      }
    };
    const nextFn = () => {};

    authenticate(reqPatient, resForbidden, () => {});
    const adminGuard = requireRole(['administrator']);
    adminGuard(reqPatient, resForbidden, nextFn);

    assert.strictEqual(patientForbidden, true, 'Patient must be rejected with HTTP 403 on admin routes');

    // FrontDesk operation guard
    let frontdeskAllowed = false;
    const reqFrontdesk = { headers: { 'x-user-role': 'frontdesk' } };
    authenticate(reqFrontdesk, resForbidden, () => {});
    const frontdeskGuard = requireRole(['frontdesk', 'administrator']);
    frontdeskGuard(reqFrontdesk, resForbidden, () => {
      frontdeskAllowed = true;
    });

    assert.strictEqual(frontdeskAllowed, true, 'FrontDesk role must be allowed on frontdesk routes');
  });

  console.log('\n====================================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
