-- =====================================================================
-- Guardaroba — schema del database (v2: ricerca online del capo)
-- Da incollare UNA volta in Supabase: SQL Editor → New query → Run.
-- È idempotente: rieseguirlo non duplica nulla e non cancella dati.
--
-- Principi (pensati anche per una futura app nativa SwiftUI):
--  * chiavi primarie UUID generate dal client (funziona offline);
--  * codici stabili in inglese (es. 'winter', 'formal'); le etichette
--    italiane stanno nell'app, quindi cambiare un testo non tocca i dati;
--  * le categorie NON sono vincolate da CHECK: aggiungerne una nuova
--    non richiede migrazioni;
--  * ogni riga appartiene a un utente e la RLS la rende visibile solo a lui.
-- =====================================================================

-- ---------- Funzione di servizio: aggiorna updated_at -----------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Capi e calzature ------------------------------------------
create table if not exists public.items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind             text not null default 'garment'
                     check (kind in ('garment', 'footwear', 'accessory')),
  category         text not null,                 -- es. 'shirt', 'blazer', 'sneakers'
  name             text,                          -- nome libero, es. "Oxford azzurra"
  brand            text,
  color_primary    text,                          -- codice colore, es. 'navy'
  colors_secondary text[] not null default '{}',
  composition      jsonb not null default '[]',   -- [{"fiber":"cotone","pct":98}, ...]
  fabric           text,                          -- tessuto prevalente: cotton, linen, wool, cashmere, silk, leather, suede...
  fit              text,                          -- vestibilità da etichetta: slim, regular, comfort...
  size_label       text,                          -- es. '50', 'M', '41', 'W32 L34', '9.5'
  size_system      text check (size_system in ('IT', 'EU', 'UK', 'US', 'LETTER')),
  size_alt         jsonb not null default '[]',   -- altre taglie sull'etichetta [{"system":"US","label":"40"}]
  care             text[] not null default '{}',  -- istruzioni di lavaggio, una per voce
  warmth           smallint check (warmth between 1 and 3),  -- 1 leggero, 2 medio, 3 pesante
  seasons          text[] not null default '{}'
                     check (seasons <@ array['spring', 'summer', 'autumn', 'winter']::text[]),
  occasions        text[] not null default '{}'
                     check (occasions <@ array['formal', 'work', 'casual', 'sport']::text[]),
  fit_feel         text check (fit_feel in ('tight', 'right', 'loose')),  -- come ti veste
  price            numeric(10, 2) check (price is null or price >= 0),
  purchased_on     date,
  photo_path       text,                          -- percorso nello storage 'wardrobe'
  thumb_path       text,
  label_photo_path text,
  notes            text,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- aggiunte successive (idempotenti, per database già creati)
alter table public.items add column if not exists fabric text;

-- v2: capo riconosciuto online dai codici dell'etichetta
alter table public.items add column if not exists article_code text;         -- codice articolo/modello letto in etichetta
alter table public.items add column if not exists color_code text;           -- codice colore/variante letto in etichetta
alter table public.items add column if not exists ean text;                  -- codice a barre del cartellino
alter table public.items add column if not exists source_url text;           -- pagina prodotto da cui vengono i dati web
alter table public.items add column if not exists match_level text;          -- come è stato riconosciuto (vedi vincolo sotto)
alter table public.items add column if not exists list_price numeric(10, 2); -- prezzo di listino trovato online
alter table public.items add column if not exists catalog_photo_path text;   -- foto di catalogo nello storage 'wardrobe'
alter table public.items add column if not exists catalog_thumb_path text;
alter table public.items add column if not exists cover text;                -- foto di copertina: 'own' o 'catalog'

-- exact = codice a barre o articolo+colore; model = articolo trovato, colore scelto da te;
-- chosen = pagina scelta da te tra i candidati
-- v3: accessori (cinture). Le categorie nuove, come 'suit' (completo), non richiedono modifiche.
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('garment', 'footwear', 'accessory'));

alter table public.items drop constraint if exists items_match_level_check;
alter table public.items add constraint items_match_level_check
  check (match_level is null or match_level in ('exact', 'model', 'chosen'));
alter table public.items drop constraint if exists items_cover_check;
alter table public.items add constraint items_cover_check
  check (cover is null or cover in ('own', 'catalog'));
alter table public.items drop constraint if exists items_list_price_check;
alter table public.items add constraint items_list_price_check
  check (list_price is null or list_price >= 0);

create index if not exists items_user_idx on public.items (user_id);

drop trigger if exists items_updated_at on public.items;
create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- ---------- Registro "indossato" --------------------------------------
create table if not exists public.wear_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  worn_on    date not null,
  outfit_id  uuid,          -- raggruppa i capi indossati insieme lo stesso giorno
  occasion   text check (occasion is null or occasion in ('formal', 'work', 'casual', 'sport')),
  created_at timestamptz not null default now(),
  unique (item_id, worn_on)
);

create index if not exists wear_log_user_day_idx on public.wear_log (user_id, worn_on desc);
create index if not exists wear_log_item_idx on public.wear_log (item_id);

-- ---------- Misure corporee (una riga per aggiornamento = storico) ----
create table if not exists public.measurements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on    date not null default current_date,
  height_cm      numeric(5, 1),
  neck_cm        numeric(4, 1),
  shoulders_cm   numeric(4, 1),
  chest_cm       numeric(5, 1),
  waist_cm       numeric(5, 1),
  hips_cm        numeric(5, 1),
  arm_length_cm  numeric(4, 1),
  inseam_cm      numeric(4, 1),
  thigh_cm       numeric(4, 1),
  foot_length_cm numeric(4, 1),
  foot_width_cm  numeric(4, 1),
  shoe_it        numeric(3, 1),
  shoe_eu        numeric(3, 1),
  shoe_uk        numeric(3, 1),
  shoe_us        numeric(3, 1),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, measured_on)
);

create index if not exists measurements_user_day_idx on public.measurements (user_id, measured_on desc);

drop trigger if exists measurements_updated_at on public.measurements;
create trigger measurements_updated_at before update on public.measurements
  for each row execute function public.set_updated_at();

-- ---------- Permessi: solo utenti autenticati, mai anonimi ------------
revoke all on public.items, public.wear_log, public.measurements from anon;
grant select, insert, update, delete on public.items, public.wear_log, public.measurements to authenticated;

-- ---------- Row Level Security ----------------------------------------
alter table public.items        enable row level security;
alter table public.wear_log     enable row level security;
alter table public.measurements enable row level security;

-- items
drop policy if exists "items: lettura propria"   on public.items;
drop policy if exists "items: inserimento proprio" on public.items;
drop policy if exists "items: modifica propria"  on public.items;
drop policy if exists "items: cancellazione propria" on public.items;
create policy "items: lettura propria" on public.items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "items: inserimento proprio" on public.items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "items: modifica propria" on public.items
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "items: cancellazione propria" on public.items
  for delete to authenticated using (user_id = (select auth.uid()));

-- wear_log (in più: il capo registrato deve essere tuo)
drop policy if exists "wear_log: lettura propria"   on public.wear_log;
drop policy if exists "wear_log: inserimento proprio" on public.wear_log;
drop policy if exists "wear_log: modifica propria"  on public.wear_log;
drop policy if exists "wear_log: cancellazione propria" on public.wear_log;
create policy "wear_log: lettura propria" on public.wear_log
  for select to authenticated using (user_id = (select auth.uid()));
create policy "wear_log: inserimento proprio" on public.wear_log
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i
                where i.id = item_id and i.user_id = (select auth.uid()))
  );
create policy "wear_log: modifica propria" on public.wear_log
  for update to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i
                where i.id = item_id and i.user_id = (select auth.uid()))
  );
create policy "wear_log: cancellazione propria" on public.wear_log
  for delete to authenticated using (user_id = (select auth.uid()));

-- measurements
drop policy if exists "misure: lettura propria"   on public.measurements;
drop policy if exists "misure: inserimento proprio" on public.measurements;
drop policy if exists "misure: modifica propria"  on public.measurements;
drop policy if exists "misure: cancellazione propria" on public.measurements;
create policy "misure: lettura propria" on public.measurements
  for select to authenticated using (user_id = (select auth.uid()));
create policy "misure: inserimento proprio" on public.measurements
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "misure: modifica propria" on public.measurements
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "misure: cancellazione propria" on public.measurements
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Storage foto: bucket PRIVATO, cartella = id utente --------
-- Percorsi: <user_id>/<item_id>/photo-… | thumb-… | label-… | catalog-… | catalog-thumb-… (.jpg)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wardrobe: lettura propria"   on storage.objects;
drop policy if exists "wardrobe: caricamento proprio" on storage.objects;
drop policy if exists "wardrobe: modifica propria"  on storage.objects;
drop policy if exists "wardrobe: cancellazione propria" on storage.objects;
create policy "wardrobe: lettura propria" on storage.objects
  for select to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "wardrobe: caricamento proprio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "wardrobe: modifica propria" on storage.objects
  for update to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "wardrobe: cancellazione propria" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- v4: fantasia del tessuto (tinta unita, righe, gessato, quadri, principe di Galles, pied de poule, spigato, microfantasia, pois, stampa).
-- Con righe o quadri: color_primary = colore del fondo, colors_secondary = colori delle righe o dei quadri.
alter table public.items add column if not exists pattern text;
alter table public.items drop constraint if exists items_pattern_check;
alter table public.items add constraint items_pattern_check
  check (pattern is null or pattern in ('solid', 'stripes', 'pinstripe', 'checks', 'glen', 'houndstooth', 'herringbone', 'micro', 'dots', 'print'));

-- v5: capi che vanno bene sotto la giacca (anche dei completi). null = valore della categoria (sì per le polo)
alter table public.items add column if not exists under_jacket boolean;

-- ---------- Eventi e viaggi (v5) -----------------------------------------
-- days: [{ date, dress }] con il dress code di ogni giorno; outfits: [{ date, items: [id capo], alt }] proposte salvate
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('event', 'trip')),
  title      text not null,
  place      jsonb,                                   -- { name, lat, lon }
  start_on   date not null,
  end_on     date not null,
  days       jsonb not null default '[]',
  outfits    jsonb not null default '[]',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_on >= start_on)
);
create index if not exists plans_user_start_idx on public.plans (user_id, start_on);
drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;
alter table public.plans enable row level security;
drop policy if exists "plans: lettura propria" on public.plans;
drop policy if exists "plans: inserimento proprio" on public.plans;
drop policy if exists "plans: modifica propria" on public.plans;
drop policy if exists "plans: cancellazione propria" on public.plans;
create policy "plans: lettura propria" on public.plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "plans: inserimento proprio" on public.plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "plans: modifica propria" on public.plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "plans: cancellazione propria" on public.plans
  for delete to authenticated using ((select auth.uid()) = user_id);
