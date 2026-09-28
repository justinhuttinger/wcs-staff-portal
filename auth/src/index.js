// Entry point. Loads the club list from the database first, then the app.
//
// Many modules build club lists when they are first required, so the list has
// to be in place before app.js (and everything it requires) loads. See
// config/loadClubs.js; it never throws, falling back to the bundled list.
require('dotenv').config()

require('./config/loadClubs').loadClubs().then(() => {
  require('./app')
})
