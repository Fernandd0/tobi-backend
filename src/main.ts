import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.use(helmet({ crossOriginResourcePolicy: false }))
  app.use(cookieParser())
  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })

  const port = process.env.APP_PORT ?? 4000
  await app.listen(port)
  console.log(`TOBI API on http://127.0.0.1:${port}`)
}
bootstrap()
