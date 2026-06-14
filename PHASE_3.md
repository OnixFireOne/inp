# PHASE_3.md — inp.one v2: аккаунты + синк watchlist + Web3-вход

> Предусловие: Phase 1–2 готовы (каталог + живые цены/график).
> Цель фазы: вход через email magic-link, Google OAuth и Web3 (EVM/SIWE); watchlist хранится локально до входа и синкается в аккаунт после.
> Код/идентификаторы — английский. Web3 пока только EVM (Solana позже).

---

## 0. Что делаем в этой фазе

1. Supabase Auth: email magic-link + Google OAuth.
2. Web3-вход: SIWE (Sign-In With Ethereum) + WalletConnect, привязка к Supabase-сессии.
3. Таблицы `profiles` и `watchlist` + RLS (каждый видит только своё).
4. Локальный watchlist (гость) → миграция в аккаунт при первом входе.
5. Оптимистичный тогл watchlist (звёздочка в строке/карточке).
6. Роль `admin` в `profiles` — задел под Phase 5 (админка).

---

## 1. ENV (добавить)

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...                 # только на сервере!
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
SIWE_SESSION_SECRET=...                        # для подписи nonce/сессии
```

---

## 2. Схема БД + RLS (Supabase migration)

```sql
-- profiles: 1:1 с auth.users
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  wallet_address text unique,
  created_at timestamptz not null default now()
);

-- watchlist: много активов на юзера
create table if not exists watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

alter table profiles enable row level security;
alter table watchlist enable row level security;

-- profiles: читаешь/меняешь только свой
create policy profiles_self_select on profiles
  for select using (auth.uid() = user_id);
create policy profiles_self_upsert on profiles
  for insert with check (auth.uid() = user_id);
create policy profiles_self_update on profiles
  for update using (auth.uid() = user_id);

-- watchlist: полный CRUD только по своим строкам
create policy watchlist_self_all on watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- автосоздание profile при регистрации
create or replace function handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into profiles(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

---

## 3. Supabase клиенты (browser + server)

```ts
// lib/supabase/client.ts (browser)
import { createBrowserClient } from "@supabase/ssr"
export const supabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
```

```ts
// lib/supabase/server.ts (server / route handlers)
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => store.getAll(),
      setAll: (xs) => xs.forEach(({name,value,options}) => store.set(name,value,options)),
    }},
  )
}
```

---

## 4. Вход: email magic-link + Google

```tsx
// components/auth/SignInDialog.tsx (фрагмент)
const sb = supabaseBrowser()

async function signInEmail(email: string) {
  await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/auth/callback` },
  })
  // показать «проверьте почту»
}

async function signInGoogle() {
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth/callback` },
  })
}
```

```ts
// app/auth/callback/route.ts — обмен code → сессия
import { NextRequest, NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabase/server"
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  if (code) {
    const sb = await supabaseServer()
    await sb.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL("/", req.url))
}
```

---

## 5. Web3-вход (SIWE + WalletConnect, EVM)

Схема: кошелёк подписывает сообщение SIWE → сервер проверяет подпись → создаёт/находит Supabase-юзера по wallet_address → выдаёт сессию.

```ts
// app/api/siwe/nonce/route.ts
import { randomBytes } from "crypto"
export async function GET() {
  const nonce = randomBytes(16).toString("hex")
  // сохранить nonce в httpOnly cookie (или KV на 1–5 мин)
  return new Response(JSON.stringify({ nonce }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `siwe_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
    },
  })
}
```

```ts
// app/api/siwe/verify/route.ts
import { SiweMessage } from "siwe"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

export async function POST(req: Request) {
  const { message, signature } = await req.json()
  const nonce = (await cookies()).get("siwe_nonce")?.value
  const siwe = new SiweMessage(message)
  const result = await siwe.verify({ signature, nonce })
  if (!result.success) return Response.json({ ok: false }, { status: 401 })

  const address = siwe.address.toLowerCase()
  // service-role клиент — только на сервере
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  // найти юзера по wallet_address или создать (email-less identity)
  // выдать magic-link / сессию через admin.auth.admin.generateLink(...)
  // записать profiles.wallet_address = address
  return Response.json({ ok: true })
}
```

Правила:
- На клиенте — wagmi + WalletConnect connector (`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).
- nonce обязателен (защита от replay), живёт коротко.
- `SUPABASE_SERVICE_ROLE_KEY` — ТОЛЬКО на сервере, никогда не в клиентском бандле.
- Solana не делаем в этой фазе — интерфейс connector'ов оставить расширяемым.

---

## 6. Watchlist: гость → аккаунт (синк)

Логика:
- **Гость:** watchlist в `localStorage` (`inp.watchlist` = `string[]` из asset_id).
- **После входа:** одноразовая миграция — всё из localStorage уходит в `watchlist` (upsert), затем localStorage очищается, источник правды — БД.

```ts
// lib/watchlist/migrate.ts
export async function migrateGuestWatchlist(sb: SupabaseClient, userId: string) {
  const raw = localStorage.getItem("inp.watchlist")
  if (!raw) return
  const ids: string[] = JSON.parse(raw)
  if (ids.length) {
    await sb.from("watchlist").upsert(
      ids.map(asset_id => ({ user_id: userId, asset_id })),
      { onConflict: "user_id,asset_id", ignoreDuplicates: true },
    )
  }
  localStorage.removeItem("inp.watchlist")
}
// вызвать один раз в onAuthStateChange(SIGNED_IN)
```

```ts
// hooks/useWatchlist.ts — единый интерфейс для гостя и авторизованного
// гость → localStorage; авторизован → Supabase + TanStack Query с optimistic update
export function useWatchlist() {
  // toggle(assetId): оптимистично меняем локальный кэш, затем insert/delete в БД, при ошибке — откат
  // isInWatchlist(assetId): boolean
  return { ids, toggle, isInWatchlist, isLoading }
}
```

---

## 7. UI-интеграция

- Звёздочка (watchlist toggle) в `AssetRow` и в шапке карточки; `stopPropagation`, чтобы клик по звёздочке не открывал drawer.
- Фильтр/вкладка «Избранное» в шапке таблицы (показывать только из watchlist).
- Кнопка «Войти» в шапке сайта → `SignInDialog` (email / Google / кошелёк).
- Гостю звёздочка работает сразу (localStorage), без принудительного логина.

---

## 8. Критерии приёмки Phase 3

- [ ] Вход работает: email magic-link, Google OAuth, Web3 (EVM/SIWE) — все три дают валидную сессию.
- [ ] Гость может добавлять в watchlist (localStorage) без входа.
- [ ] При первом входе гостевой watchlist мигрирует в аккаунт, локальный очищается.
- [ ] Watchlist синкается между устройствами (источник правды — БД).
- [ ] RLS: юзер не видит и не меняет чужие строки (проверить запросом под другим юзером).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` не попадает в клиентский бандл.
- [ ] Тогл звёздочки оптимистичен, при ошибке сети — корректный откат.
- [ ] Клик по звёздочке не открывает drawer (stopPropagation).

---

## 9. Дальше (Phase 4 — превью)

Адаптив (мобильный bottom-sheet, плотность) + deep-links/intercepting routes `inp.one/asset/[id]` (прямая ссылка открывает карточку, назад — возврат к таблице), SSR-метаданные для шаринга. Детализирую отдельным файлом.
