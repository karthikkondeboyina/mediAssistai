const nodemailer = require('nodemailer');
const db = require('../db');
const eventBus = require('../events/eventBus');

class NotificationService {
  constructor() {
    this.mailer = null;
    this.isConfigured = false;
    this.initMailer();
    this.registerEventHandlers();
  }

  initMailer() {
    const user = process.env.EMAIL_USER || process.env.SMTP_USER || 'karthikkondeboyina@gmail.com';
    const pass = process.env.EMAIL_APP_PASSWORD || process.env.SMTP_PASS;

    if (pass && pass.trim() !== '' && pass !== 'your_16_digit_app_password_here') {
      this.mailer = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      });
      this.isConfigured = true;
      console.log(`[NotificationService] Gmail SMTP transport configured for ${user}.`);
    } else {
      this.mailer = null;
      this.isConfigured = false;
      console.log('[NotificationService] EMAIL_APP_PASSWORD not set. Real email delivery paused.');
    }
  }

  async verifyConnection() {
    if (!this.isConfigured || !this.mailer) {
      return { success: false, message: 'EMAIL_APP_PASSWORD is not configured in .env' };
    }
    try {
      await this.mailer.verify();
      return { success: true, message: 'SMTP connection to Gmail verified successfully.' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  registerEventHandlers() {
    eventBus.on('appointment.created', async (appointment) => {
      await this.handleAppointmentNotification(appointment, 'appointment.created', 'Appointment Confirmation');
    });

    eventBus.on('appointment.rescheduled', async (appointment) => {
      await this.handleAppointmentNotification(appointment, 'appointment.rescheduled', 'Appointment Rescheduled');
    });

    eventBus.on('appointment.cancelled', async (appointment) => {
      await this.handleAppointmentNotification(appointment, 'appointment.cancelled', 'Appointment Cancellation');
    });
  }

  async handleAppointmentNotification(appointment, eventType, subjectPrefix) {
    const notificationId = 'NOTIF-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // Use patient's registered email address as primary recipient, with override option for testing
    let recipient = appointment.patient_email;
    if (process.env.FORCE_TEST_RECIPIENT === 'true' && process.env.TEST_EMAIL_RECIPIENT) {
      recipient = process.env.TEST_EMAIL_RECIPIENT;
    }

    // 1. Record notification in pending state
    const insertStmt = db.prepare(`
      INSERT INTO notifications (
        id, appointment_id, event_type, recipient_email, channel, status, payload
      ) VALUES (?, ?, ?, ?, 'email', 'pending', ?)
    `);
    
    insertStmt.run(
      notificationId,
      appointment.id,
      eventType,
      recipient,
      JSON.stringify(appointment)
    );

    // 2. Dispatch email only when provider is confirmed and configured
    try {
      const emailContent = this.formatAppointmentEmail(appointment, eventType);
      
      if (this.isConfigured && this.mailer) {
        const fromAddress = process.env.EMAIL_USER || process.env.SMTP_FROM || 'care@mediassist.ai';
        const info = await this.mailer.sendMail({
          from: `"MediAssist Medical Center" <${fromAddress}>`,
          to: recipient,
          subject: `${subjectPrefix}: ${appointment.id} - MediAssist Medical Center`,
          html: emailContent.html,
          text: emailContent.text
        });

        this.updateNotificationStatus(notificationId, 'sent', null);
        console.log(`[NotificationService] Email sent successfully to ${recipient} (Message ID: ${info.messageId})`);
      } else {
        // If simulation mode is explicitly enabled for unit tests, allow it; otherwise mark as failed
        if (process.env.SIMULATE_EMAIL_DELIVERY === 'true') {
          this.updateNotificationStatus(notificationId, 'sent', null);
          console.log(`[NotificationService] Test simulation: Email marked sent for ${appointment.id}`);
        } else {
          const reason = 'Email provider not configured (EMAIL_APP_PASSWORD missing). Real email not sent.';
          this.updateNotificationStatus(notificationId, 'failed', reason);
          console.log(`[NotificationService] ${reason}`);
        }
      }
    } catch (err) {
      // Sanitize any potential secrets from the error message
      const sanitized = (err.message || 'SMTP delivery failure').replace(/password=[^&\s]+/gi, 'password=***');
      console.error(`[NotificationService] Email delivery failed for ${appointment.id}:`, sanitized);
      this.updateNotificationStatus(notificationId, 'failed', sanitized);
    }
  }

  updateNotificationStatus(notificationId, status, errorMessage) {
    const updateStmt = db.prepare(`
      UPDATE notifications 
      SET status = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?
    `);
    updateStmt.run(status, errorMessage, status, notificationId);
  }

  formatAppointmentEmail(appointment, eventType) {
    const isCancelled = eventType === 'appointment.cancelled';
    const isRescheduled = eventType === 'appointment.rescheduled';

    const subject = isCancelled
      ? `Appointment Cancelled - Ref: ${appointment.id}`
      : isRescheduled
      ? `Appointment Rescheduled - Ref: ${appointment.id}`
      : `Your Appointment is Confirmed - Ref: ${appointment.id}`;

    const text = `
Dear ${appointment.patient_name},

${isCancelled ? 'Your appointment has been cancelled.' : isRescheduled ? 'Your appointment has been successfully rescheduled.' : 'Your appointment has been successfully confirmed.'}

Appointment Details:
- Appointment ID: ${appointment.id}
- Doctor: ${appointment.doctor_name || 'Dr. ' + appointment.doctor_id}
- Department: ${appointment.department_name || appointment.department_id}
- Date: ${appointment.appointment_date}
- Time: ${appointment.appointment_time}
- Hospital: MediAssist Medical Center, 128 Wellness Avenue, Medical District, NY 10021
- Status: ${appointment.status}

Important Instructions:
Please arrive 15 minutes before your scheduled appointment time. Bring your photo ID and any previous medical records.

If you need to make changes, please visit your patient portal or call our front desk at +1 (555) 123-4567.

Warm regards,
MediAssist Medical Center Care Team
care@mediassist.ai
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f8fa; color: #172b4d; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5eaf0; overflow: hidden; }
    .header { background: linear-gradient(135deg, #087f8c 0%, #065d68 100%); color: white; padding: 24px; text-align: center; }
    .content { padding: 24px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 12px; background: ${isCancelled ? '#fee2e2; color: #d94848;' : '#e9f6f5; color: #087f8c;'} }
    .details { background: #f6f8fa; border-radius: 8px; padding: 16px; margin: 20px 0; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5eaf0; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #667085; }
    .val { font-weight: 600; color: #172b4d; }
    .footer { padding: 16px 24px; background: #f6f8fa; font-size: 12px; color: #667085; text-align: center; border-top: 1px solid #e5eaf0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0; font-size:20px;">MediAssist Medical Center</h1>
      <p style="margin:4px 0 0 0; opacity:0.85; font-size:14px;">Healthcare appointments, made simpler.</p>
    </div>
    <div class="content">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2 style="margin:0; font-size:18px;">${subject}</h2>
        <span class="badge">${appointment.status.toUpperCase()}</span>
      </div>
      <p style="margin:16px 0; font-size:14px; color:#475467;">
        Hello <strong>${appointment.patient_name}</strong>,<br>
        ${isCancelled ? 'Your appointment has been cancelled.' : isRescheduled ? 'Your consultation date and time have been updated as requested.' : 'We are pleased to confirm your appointment at MediAssist Medical Center.'}
      </p>
      <div class="details">
        <div class="row"><span class="label">Appointment ID</span><span class="val">${appointment.id}</span></div>
        <div class="row"><span class="label">Doctor</span><span class="val">${appointment.doctor_name || appointment.doctor_id}</span></div>
        <div class="row"><span class="label">Department</span><span class="val">${appointment.department_name || appointment.department_id}</span></div>
        <div class="row"><span class="label">Date & Time</span><span class="val">${appointment.appointment_date} at ${appointment.appointment_time}</span></div>
        <div class="row"><span class="label">Location</span><span class="val">128 Wellness Ave, Medical District, NY</span></div>
        <div class="row"><span class="label">Consultation Fee</span><span class="val">$${appointment.consultation_fee || 180}</span></div>
      </div>
      <p style="font-size:13px; color:#667085; line-height:1.5;">
        <strong>Instructions:</strong> Please arrive 15 minutes before your scheduled appointment. Bring your ID and relevant medical records. For emergencies, please call emergency services immediately.
      </p>
    </div>
    <div class="footer">
      MediAssist Medical Center &bull; Phone: +1 (555) 123-4567 &bull; care@mediassist.ai
    </div>
  </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  getNotificationsForAppointment(appointmentId) {
    return db.prepare('SELECT * FROM notifications WHERE appointment_id = ? ORDER BY created_at DESC').all(appointmentId);
  }

  getAllNotifications(limit = 50) {
    return db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit);
  }
}

const notificationService = new NotificationService();
module.exports = notificationService;
