require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes (added in subsequent tasks)
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
// app.use('/admin', require('./routes/admin'))
// app.use('/config', require('./routes/config'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`WCS Auth API listening on port ${PORT}`))
