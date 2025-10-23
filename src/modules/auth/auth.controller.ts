import {
  Controller,
  Get,
  Res,
  Req,
  Post,
  HttpException,
  HttpStatus
} from '@nestjs/common'
import { AuthService } from './auth.service'
import type { Request, Response } from 'express'

@Controller('auth/spotify')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  isProd = process.env.NODE_ENV === 'production'

  private cookieOpts = {
    httpOnly: true as const,
    secure: false as const,
    sameSite: 'lax' as const,
    path: '/'
  }

  @Get('login')
  async login(@Res() res: Response) {
    const state = this.auth.makeState()
    res.cookie('oauth_state', state, {
      ...this.cookieOpts,
      maxAge: 10 * 60 * 1000
    })

    const scope = [
      'user-read-email',
      'user-read-private',
      'user-top-read',
      'user-read-recently-played',
      'playlist-read-private'
    ].join(' ')

    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      scope,
      state,
      show_dialog: 'true'
    })

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`)
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const { code, state } = req.query as { code?: string; state?: string }
    const savedState = (req as any).cookies?.oauth_state
    if (!code || !state || !savedState || state !== savedState) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=state_mismatch`)
    }

    try {
      const tokens = await this.auth.exchangeCodeForTokens(code)
      const me = await this.auth.getSpotifyMe(tokens.access_token)
      console.log('spotify me:', me)

      res.cookie('refresh_token', tokens.refresh_token, {
        ...this.cookieOpts,
        maxAge: 30 * 24 * 60 * 60 * 1000
      })

      const appToken = await this.auth.signAppToken(
        {
          sub: me.id,
          name: me.display_name,
          email: me.email,
          pic: me.images?.[0]?.url ?? null
        },
        '15m'
      )

      res.cookie('app_session', appToken, {
        ...this.cookieOpts,
        maxAge: 15 * 60 * 1000
      })

      res.clearCookie('oauth_state', this.cookieOpts)

      return res.redirect(`${process.env.FRONTEND_URL}`)
    } catch (e) {
      console.error('OAuth error:', e)
      return res.redirect(`${process.env.FRONTEND_URL}/?error=oauth_failed`)
    }
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const refresh_token = (req as any).cookies?.refresh_token
    if (!refresh_token)
      throw new HttpException('Missing refresh token', HttpStatus.UNAUTHORIZED)

    try {
      const data = await this.auth.refreshWithSpotify(refresh_token)
      const me = await this.auth.getSpotifyMe(data.access_token)

      const newAppToken = await this.auth.signAppToken(
        {
          sub: me.id,
          name: me.display_name,
          email: me.email,
          pic: me.images?.[0]?.url ?? null
        },
        '15m'
      )

      res.cookie('app_session', newAppToken, {
        ...this.cookieOpts,
        maxAge: 15 * 60 * 1000
      })
      return res.json({ ok: true })
    } catch (e) {
      console.error(
        'Refresh error:',
        (e as any).response?.data || (e as any).message
      )
      return res.status(401).json({ ok: false })
    }
  }

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    const bearer = req.headers.authorization?.split(' ')[1]
    const token = (req as any).cookies?.app_session || bearer
    if (!token) return res.status(401).send('No session')

    try {
      const { payload } = await this.auth.verifyAppToken(token)
      console.log('Verified payload:', payload)
      return res.json({ user: payload })
    } catch {
      return res.status(401).send('Invalid session')
    }
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('app_session', this.cookieOpts)
    res.clearCookie('refresh_token', this.cookieOpts)
    return res.json({ ok: true })
  }
}
