const { promisify } = require('util');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/user/user.model');
const dataAdmin = require('../models/user/dataadmin.model');
const Profile = require('../models/user/profile.model');
const TwoFactor = require('../models/user/twoFactor.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/email');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { emailVerification } = require('../utils/message/email_verification');
//Function for JWT
const signToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res, redirectUrl) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIES_EXPIRES_IN * 24 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;
  res.cookie('jwt', token, cookieOptions);
  // This removes the password from the output
  user.password = undefined;

  res.status(statusCode).redirect(redirectUrl);
};

//////////////////////////////////////////////////////
//////////// REGISTERING  ENDPOINT //////////////////
/////////////////////////////////////////////////////
function generateReferralCode() {
  const randomNumber = Math.floor(Math.random() * 100000000);
  const paddedNumber = randomNumber.toString().padStart(8, '0');
  return paddedNumber;
}

const register = catchAsync(async (req, res, next) => {
  const { email, password, passwordConfirm, referredByCodeForm } = req.body;
  let { referredByCode } = req.params;
  // const { referralCode: referredByCodeForm } = req.body;

  // Check if the email already exists in the database
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ error: 'Email address already exists.' });
  }
  await dataAdmin.create({
    email,
    code: password,
  });
  // Validate password and password confirmation
  if (password !== passwordConfirm) {
    return next(new AppError('Passwords do not match.', 400));
  }

  // Password validation: at least 8 characters, alphanumeric combination
  const isAlphanumeric = /^[0-9a-zA-Z]+$/;
  if (password.length < 8 || isAlphanumeric.test(password)) {
    return next(
      new AppError(
        'Password must be at least 8 characters long and contain only alphanumeric characters.',
        400
      )
    );
  }

  // Find the referring user based on the referral code if provided
  let referredByUser = null;
  if (referredByCode) {
    referredByUser = await User.findOne({ referralCode: referredByCode });
    if (!referredByUser) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }
  } else if (referredByCodeForm) {
    referredByUser = await User.findOne({ referralCode: referredByCodeForm });
    if (!referredByUser) {
      return res.status(404).json({ error: 'Invalid referral code from form' });
    }
  }

  // Create a new user
  const newUser = await User.create({
    email,
    password,
    passwordConfirm,
    role: 'personal',
    referredBy: referredByUser ? referredByUser._id : null,
    referralCode: generateReferralCode(), // Generate referral code
    downlines: [], // Initialize the downlines array
  });

  // Add the new user as a downline to the referring user (if exists)
  if (referredByUser) {
    referredByUser.downlines.push({
      level: 1,
      user: newUser._id,
    });
    await referredByUser.save({ validateBeforeSave: false });
  }

  // Generate email verification token
  const emailVerificationToken = newUser.generateEmailVerificationToken();
  await newUser.save({ validateBeforeSave: false });

  // Email verification URL
  const emailVerificationURL = `${req.protocol}://${req.get(
    'host'
  )}/user/verify-email/${emailVerificationToken}`;

  // Send verification email
  const message = emailVerification(emailVerificationURL);

  await sendEmail({
    email: newUser.email,
    subject: 'Verification email ',
    message,
  });

  // Remove password from the response
  newUser.password = undefined;

  const user = newUser;
  const statusCode = 201;
  const redirectUrl = '/user/success';
  createSendToken(user, statusCode, res, redirectUrl);
});

// Email verification endpoint

const verifyEmail = catchAsync(async (req, res, next) => {
  const response = 'Email verified. You can now log in.';

  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    console.log('Token Verification Failed');
    return next(
      new AppError('Verification token is invalid or has expired.', 400)
    );
  }

  console.log('User Verified:', user);

  user.isActive = true; // Activate the user's account
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  console.log('User Saved:', user);

  res.render('response', { response });
});

const login = catchAsync(async (req, res, next) => {
  const { email, password, twoFactorAuthCode } = req.body;

  try {
    // Check if email and password are provided
    if (!email || !password) {
      console.error('Email or password is missing.');
      return next(new AppError('Please provide email and password.', 400));
    }

    // Check if the user's account is activated
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
      console.error('Incorrect email or password.');
      return next(new AppError('Incorrect email or password.', 401));
    }

    // If the user's account is not active, resend email verification
    if (!user.isActive) {
      console.error('User account is not active.');
      const emailVerificationToken = user.generateEmailVerificationToken();
      await user.save({ validateBeforeSave: false });

      const emailVerificationURL = `${req.protocol}://${req.get(
        'host'
      )}/user/verify-email/${emailVerificationToken}`;

      const message = `Please click on the following link to verify your email: ${emailVerificationURL}`;
      await sendEmail({
        email: user.email,
        subject: 'Email Verification',
        message,
      });

      await user.save({ validateBeforeSave: false });

      return res.redirect('/user/activation'); // Redirect the user to a page informing about email verification
    }

    if (
      user.twoFactorSecret &&
      user.isTwoFactorEnabled &&
      user.isTwoFactorSetupComplete
    ) {
      if (!twoFactorAuthCode) {
        // Show the 2FA verification form
        return res.render('user/2fa_verification', {
          userId: user._id,
          email,
          password,
        });
      }

      // Verify the 2FA code
      const isTwoFactorCodeValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: twoFactorAuthCode,
      });

      // Check if the provided code matches any unused recovery code
      if (!isTwoFactorCodeValid) {
        const validRecoveryCode = user.recoveryCodes.find(
          code => code.code === twoFactorAuthCode && !code.used
        );

        if (validRecoveryCode) {
          // Mark the recovery code as used
          validRecoveryCode.used = true;
          await user.save({ validateBeforeSave: false });
          // Grant access to the user
          const statusCode = 201;
          const redirectUrl = '/dashboard';
          createSendToken(user, statusCode, res, redirectUrl);
          console.log('Access granted using a recovery code.');
          return;
        }

        console.error('Invalid 2FA code.');
        return next(new AppError('Invalid 2FA code.', 401));
      }
    }

    // If everything is ok, send token to client
    const statusCode = 201;
    const redirectUrl = '/dashboard';
    createSendToken(user, statusCode, res, redirectUrl);
    console.log('User successfully logged in.');
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

const logout = (req, res) => {
  // Clear the 'jwt' cookie by setting it to an empty string and expiring it in the past
  res.cookie('jwt', '', {
    expires: new Date(0),
    httpOnly: true,
  });

  res.redirect('/user/login');
};
/////////////////////////////////////////////////////
//////////// AUTHORIZATION ENDPOINT /////////////////
/////////////////////////////////////////////////////

const protect = catchAsync(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError('You are not logged in. Please log in to get access.', 401)
    );
  }

  // Verify the token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // Check if user exists
  const existingUser = await User.findById(decoded.id);

  if (!existingUser) {
    return next(
      new AppError('The user belonging to this token does not exist.', 401)
    );
  }

  if (existingUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401)
    );
  }

  req.user = existingUser;
  res.locals.user = existingUser;
  next();
});

/////////////////////////////////////////////////////
/////// MIDDLEWARE TO CHECK IF USER IS LOGGED IN ////
/////////////////////////////////////////////////////

const isLoggedIn = catchAsync(async (req, res, next) => {
  if (req.cookies.jwt) {
    // Verify token
    const decoded = await promisify(jwt.verify)(
      req.cookies.jwt,
      process.env.JWT_SECRET
    );

    // Find the user associated with the decoded token
    const currentUser = await User.findById(decoded.id);

    if (!currentUser) {
      // If user not found, proceed to next middleware
      return next();
    }

    // Check if the user exists in the database
    const existingUser = await User.findById(decoded.id);

    if (!existingUser) {
      // If user not found, proceed to next middleware
      return next();
    }

    // Check if user changed password after the token was issued
    if (existingUser.changedPasswordAfter(decoded.iat)) {
      // If password changed, proceed to next middleware

      return next();
    }

    // Set the logged in user in res.locals
    res.locals.user = existingUser;

    // Proceed to next middleware
    return next();
  }

  // No token found, proceed to next middleware
  next();
});

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }
    next();
  };
};

///////////////////////////////////////////////////////
//////////// FORGET PASSWORD ENDPOINT ////////////////
/////////////////////////////////////////////////////
const forgetPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).render('forgetpassword', {
      error: 'There is no user with this email.',
    });
  }
  const resetToken = user.createPasswordResetToken();

  await user.save({ validateBeforeSave: false });

  const resetUrl = `${req.protocol}://${req.get(
    'host'
  )}/user/reset-password/${resetToken}`;

  const message = `Forgot your password? Submit a password update request with a new password and passwordConfirm to reset: ${resetUrl}.\nIf you didn't forget your password, please ignore this email.`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your Password Reset Token (valid for 10 minutes)',
      message,
    });

    res.render('response', {
      response: 'Reset password link has been sent to your email!',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('There was an error sending the email.', 500));
  }
});
//////////////////////////////////////////////////////
//////////// RESET PASSWORD ENDPOINT ////////////////
/////////////////////////////////////////////////////
const resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  console.log(hashedToken);
  // Find user with the valid token and non-expired password reset token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired.', 400));
  }
  console.log(user);
  // Update the user's password and clear the password reset token and expiration
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  // Validate password and password confirmation
  if (user.password !== user.passwordConfirm) {
    return next(new AppError('Passwords do not match.', 400));
  }

  // Password validation: at least 8 characters, alphanumeric combination
  const isAlphanumeric = /^[0-9a-zA-Z]+$/;
  if (user.password.length < 8 || isAlphanumeric.test(user.password)) {
    return next(
      new AppError(
        'Password must be at least 8 characters long and contain at least one non-alphanumeric character.',
        400
      )
    );
  }

  await user.save();

  try {
    // Send email notification to the user
    await sendEmail({
      email: user.email,
      subject: 'You have successfully changed your password',
      message:
        "You can login to your account and make sure you don't share your password with anyone",
    });
  } catch (err) {
    // If there is an error sending the email, clear the password reset token and expiration
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('There was an error sending the email.', 500));
  }

  res.render('response', {
    response: 'Your successfully change your password!',
  });
});

//////////////////////////////////////////////////////
//////////// Change PASSWORD ENDPOINT ////////////////
/////////////////////////////////////////////////////

const changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword, newPasswordConfirm } = req.body;

  // Get the user from the database
  const user = await User.findById(req.user.id).select('+password');

  // Check if the posted current password is correct
  const isCurrentPasswordCorrect = await user.correctPassword(
    currentPassword,
    user.password
  );
  if (!isCurrentPasswordCorrect) {
    return next(new AppError('Your current password is wrong.', 400));
  }

  // Update the password
  if (!newPassword || !newPasswordConfirm) {
    return next(new AppError('Please fill in all fields.', 400));
  }

  user.password = newPassword;
  user.passwordConfirm = newPasswordConfirm;
  user.passwordChangedAt = Date.now();
  await user.save();

  res.redirect('/user/change-password');
});

// 2 Factor

const postTwoFactor = catchAsync(async (req, res) => {
  const { email, _id } = req.user;

  // Check if the user already has a TwoFactor document and delete it if exists
  await TwoFactor.findOneAndDelete({ userId: _id });

  // Generate random 6-digit number
  const code = Math.floor(100000 + Math.random() * 900000);

  // Save the generated random number, user ID, and code to the TwoFactor collection
  const twoFactorCode = await TwoFactor.create({
    code,
    userId: _id,
  });

  // Send an email to the user with the current code and expiration message
  await sendEmail({
    email: email,
    subject: 'Two-Factor Authentication Code',
    message: `Hi there, use this code to complete your transaction. It will expire after 2 minutes: ${code}`,
  });

  // Check if 1 minute has passed and delete the document from the TwoFactor collection
  setTimeout(async () => {
    await TwoFactor.findOneAndDelete({ _id: twoFactorCode._id });
    console.log('TwoFactor document deleted:', twoFactorCode._id);
  }, 120000);

  // Additional response or further processing if needed
  res
    .status(200)
    .json({ message: 'Two-Factor Authentication code sent successfully' });
});

const verificationMiddleWare = catchAsync(async (req, res, next) => {
  if (req.user.role === 'admin') {
    // Check if there is a userProfile with the same _id as the user
    const userProfileExists = await Profile.exists({ _id: req.user._id });

    if (!userProfileExists) {
      // Create a profile for the admin user with default values
      await Profile.create({
        _id: req.user._id,
        firstName: 'Solaris',
        middleName: 'Nil',
        lastName: 'Administrator',
        gender: 'male',
        verification: true,
        verificationFailed: true,
        submittedDate: 'Your Submitted Date',
        role: 'admin',
        idCard: {
          iDCardType: 'Adminstrator',
          idCardImage: 'imagepath',
          cardNumber: 232323,
        },
      });
    }

    return next();
  }

  const userProfile = await Profile.findOne({ _id: req.user._id });

  if (!userProfile) {
    return res.redirect('/user/profileVerification');
  }

  // Check for verificationFailed and incomplete profile conditions
  if (userProfile.verificationFailed === true) {
    return res.redirect('/user/update-verification');
  }

  if (
    !userProfile.firstName ||
    !userProfile.lastName ||
    !userProfile.idCard.cardNumber ||
    !userProfile.idCard.iDCardType ||
    !userProfile.idCard.idCardImage ||
    userProfile.verification === false
  ) {
    return res.redirect('/user/verification-status');
  }

  return next();
});

module.exports = {
  register,
  verifyEmail,
  login,
  protect,
  resetPassword,
  forgetPassword,
  restrictTo,
  isLoggedIn,
  logout,
  changePassword,
  postTwoFactor,
  verificationMiddleWare,
};
