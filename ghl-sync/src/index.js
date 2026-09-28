// Entry point. Loads the club list from the database first, then the app:
// config/locations and friends build club lists when first required. See
// config/loadClubs.js; it never throws, falling back to the bundled list.
require('dotenv').config();

require('./config/loadClubs').loadClubs().then(() => {
  require('./app');
});
