const path = require('path')
const dotenv = require('dotenv')
const express = require('express')
const cors = require('cors')
const contratosRoutes = require('./routes/contratos.routes')

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
const PORT = process.env.PORT || 3030

app.use(cors())
app.use(express.json())

app.use('/', contratosRoutes)

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`)
})
