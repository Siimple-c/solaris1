const nodemailer = require('nodemailer');

const sendEmail = async options => {
  //create transporter
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,

    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
  // define the email option
  const mailOptions = {
    from: 'Solaris Finance <test@abunnazeer.com.ng>',
    to: options.email,
    subject: options.subject,
    text: options.message,
  };
  //send the email
  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
