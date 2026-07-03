const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:             process.env.DB_HOST || 'localhost',
  user:             process.env.DB_USER || 'root',
  password:         process.env.DB_PASS || '',
  database:         process.env.DB_NAME || 'toppertest',
  waitForConnections: true,
  connectionLimit:  20,
  queueLimit:       0,
  charset:          'utf8mb4',
  timezone:         '+05:30',   // IST — prevents MySQL DATE shifting by UTC offset
  dateStrings:      true,       // Return DATE/DATETIME as plain strings, never JS Date objects
});

pool.getConnection()
  .then(conn => { console.log('✅ MySQL connected'); conn.release(); })
  .catch(err  => { console.error('❌ MySQL connection failed:', err.message); });

module.exports = pool;
