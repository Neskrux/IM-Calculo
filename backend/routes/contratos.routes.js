const express = require('express')
const multer = require('multer')
const { extrairContratoHandler } = require('../controllers/contratos.controller')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
})

router.post('/vendas/extrair-contrato', upload.single('file'), extrairContratoHandler)

module.exports = router
