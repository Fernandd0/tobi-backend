import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SignJWT, jwtVerify } from 'jose'
import axios from 'axios'
import crypto from 'crypto'

@Injectable()
export class AuthService {
  private appKey!: Uint8Array
  constructor(private readonly config: ConfigService) {
    const raw = (this.config.get<string>('APP_JWT_SECRET') ?? '').trim()
    if (!raw) {
      throw new Error('APP_JWT_SECRET is missing or empty')
    }
    this.appKey = new TextEncoder().encode(raw)
  }

  makeState() {
    return crypto.randomBytes(16).toString('hex')
  }

  async signAppToken(payload: Record<string, any>, expiresIn = '15m') {
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.appKey)
  }

  async verifyAppToken(token: string) {
    return await jwtVerify(token, this.appKey)
  }

  async exchangeCodeForTokens(code: string) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!
    })

    const { data } = await axios.post(
      'https://accounts.spotify.com/api/token',
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    return data as {
      access_token: string
      token_type: 'Bearer'
      scope: string
      expires_in: number
      refresh_token: string
    }
  }

  async refreshWithSpotify(refresh_token: string) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!
    })
    const { data } = await axios.post(
      'https://accounts.spotify.com/api/token',
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )
    return data as {
      access_token: string
      expires_in: number
      scope: string
      token_type: 'Bearer'
    }
  }

  async getSpotifyMe(access_token: string) {
    const { data } = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    })
    return data
  }

  encrypt(text: string) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'utf8')
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ])
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`
  }

  decrypt(payload: string) {
    const [ivHex, encHex] = payload.split(':')
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'utf8')
    const iv = Buffer.from(ivHex, 'hex')
    const encryptedText = Buffer.from(encHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv)
    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final()
    ])
    return decrypted.toString('utf8')
  }
}
