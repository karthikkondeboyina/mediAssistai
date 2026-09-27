require('dotenv').config();
const notificationService = require('../services/notificationService');

async function testEmailConnection() {
  console.log('====================================================');
  console.log(' MediAssist AI — Gmail SMTP Connection Tester');
  console.log('====================================================');

  const user = process.env.EMAIL_USER || 'karthikkondeboyina@gmail.com';
  const pass = process.env.EMAIL_APP_PASSWORD;

  console.log(`Configured Email Account: ${user}`);
  console.log(`App Password Detected:    ${pass && pass !== 'your_16_digit_app_password_here' ? 'Yes (Protected)' : 'No / Placeholder'}`);

  if (!pass || pass === 'your_16_digit_app_password_here') {
    console.log('\n[!] EMAIL_APP_PASSWORD is not set in .env.');
    console.log('To set up real Gmail integration:');
    console.log('1. Go to Google Account -> Security -> 2-Step Verification -> App passwords.');
    console.log('2. Generate a 16-character App Password (name it "MediAssist AI").');
    console.log('3. Add it to your .env file:');
    console.log('   EMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx');
    console.log('4. Run this script again: npm run test:email\n');
    return;
  }

  process.stdout.write('\nTesting SMTP handshake with smtp.gmail.com:465/587... ');
  const result = await notificationService.verifyConnection();

  if (result.success) {
    console.log('PASSED ✓');
    console.log(`[Success] Verified! MediAssist AI is ready to send automated appointment emails from ${user}.`);
  } else {
    console.log('FAILED ✗');
    const sanitized = result.message.replace(/password=[^&\s]+/gi, 'password=***');
    console.error(`[Error] ${sanitized}`);
    console.log('\nTroubleshooting tips:');
    console.log('- Ensure 2-Step Verification is turned ON for your Google account.');
    console.log('- Use a 16-character Google App Password, NOT your regular Gmail account password.');
    console.log('- Ensure no spaces were accidentally omitted or mistyped.');
  }
}

testEmailConnection().catch(err => {
  console.error('Test execution error:', err.message);
});
