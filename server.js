const http = require('http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoStore = require('connect-mongo');

process.on('uncaughtException', err => {
  console.log('UNCAUGHT EXCEPTION! server is shutting down now');
  console.log(err.name, err.message);

  process.exit(1);
});

dotenv.config({ path: './config.env' });
const app = require('./app');

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);
mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(con => {
    // console.log(con.connections);
    console.log('DB Connection Successful!');
  });

const PORT = process.env.PORT || 9000;

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Use your session secret key from the .env file
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: DB, // Use the MongoDB URL
      ttl: 7 * 24 * 60 * 60, // Session TTL (7 days in seconds)
    }),
  })
);

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});

process.on('unhandledRejection', err => {
  console.log('UNHANDLE REJECTTION! server is shutting down now');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
