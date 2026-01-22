const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;
