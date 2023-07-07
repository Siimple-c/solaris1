const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const cookieParser = require('cookie-parser');

const session = require('express-session');

// controller
const globalErrorHandler = require('./controller/error.controller');

const AppError = require('./utils/appError');
//importing routers
const userRouter = require('./routes/user.routers');
const portfolioRouter = require('./routes/portfolio.routers');
const { protect } = require('./controller/auth.controller');
const { dashboard } = require('./controller/dashboard.controller');

const app = express();

// GLOBAL MIDDLEWARE

// set security HTTP Headers

// app.use(helmet());

// loading development

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
// limit request from same API
const limiter = rateLimit({
  max: 1000,
  windowMs: 60 * 60 * 1000,
  message: 'Too Many Request from this ip, Please try again in an hour!',
});
app.use('/login', limiter);

// Body parser, reading data from the body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Data sanitazation agasnt noSQL Injection
// app.use(mongoSanitize());

// Data sanitize  against xss
app.use(xss());

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname + '/public/')));

app.get('/dashboard', protect, dashboard);
app.use('/user', userRouter);

app.use('/portfolio', portfolioRouter);

app.all('/*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});
// Error Handling midleware
app.use(globalErrorHandler);
module.exports = app;
