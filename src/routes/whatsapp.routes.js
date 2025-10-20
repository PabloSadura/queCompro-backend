import {Router} from 'express'
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from '../controllers/whatsapp.controller.js'

const route = Router()

route.get('/', verifyWhatsAppWebhook)

route.post('/', handleWhatsAppWebhook)

export default route    