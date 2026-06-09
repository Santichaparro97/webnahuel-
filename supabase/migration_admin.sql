-- ============================================================================
-- Migración inicial · Panel admin perfumescyc
-- Idempotente a nivel de objeto (usa IF NOT EXISTS) pero pensada para base vacía.
-- Aplicar UNA vez en SQL Editor de Supabase. NO borra datos.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper: trigger genérico para actualizado_en
-- ---------------------------------------------------------------------------
create or replace function public.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. CATEGORÍAS
-- ===========================================================================
create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  orden       int  not null default 0,
  creado_en   timestamptz not null default now()
);

create index if not exists idx_categorias_orden on public.categorias(orden);

-- ===========================================================================
-- 2. PRODUCTOS
-- ===========================================================================
create table if not exists public.productos (
  id                           uuid primary key default gen_random_uuid(),
  nombre                       text not null,
  descripcion                  text,
  precio                       numeric(12,2) not null,
  precio_mayorista             numeric(12,2),
  cantidad_minima_mayorista    int,
  incluir_stock                bool not null default false,
  stock                        int,
  destacar                     bool not null default false,
  visible                      bool not null default true,
  orden                        int  not null default 0,
  categoria_id                 uuid references public.categorias(id) on delete set null,
  imagenes                     text[] not null default '{}',
  creado_en                    timestamptz not null default now(),
  actualizado_en               timestamptz not null default now()
);

create index if not exists idx_productos_categoria   on public.productos(categoria_id);
create index if not exists idx_productos_visible     on public.productos(visible);
create index if not exists idx_productos_destacar    on public.productos(destacar);
create index if not exists idx_productos_orden       on public.productos(orden);

drop trigger if exists trg_productos_actualizado_en on public.productos;
create trigger trg_productos_actualizado_en
  before update on public.productos
  for each row execute function public.set_actualizado_en();

-- ===========================================================================
-- 3. VARIANTES
-- ===========================================================================
create table if not exists public.variantes (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre      text not null,
  precio      numeric(12,2),
  stock       int,
  orden       int  not null default 0
);

create index if not exists idx_variantes_producto on public.variantes(producto_id);

-- ===========================================================================
-- 4. PEDIDOS
-- ===========================================================================
create sequence if not exists public.pedidos_codigo_seq start 1;

create table if not exists public.pedidos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique not null,
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente','confirmado','entregado','cancelado')),
  total             numeric(12,2) not null,
  items             jsonb not null,
  -- items: [{producto_id, variante_id (null), nombre, cantidad, precio_unitario}]
  cliente_nombre    text not null,
  telefono          text not null,
  metodo_entrega    text,
  direccion         text,
  vendedor          text,
  notas_internas    text,
  stock_descontado  bool not null default false,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

create index if not exists idx_pedidos_estado    on public.pedidos(estado);
create index if not exists idx_pedidos_creado_en on public.pedidos(creado_en desc);

-- Autogeneración de codigo PER-00001, PER-00002, ...
create or replace function public.set_pedido_codigo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'PER-' || lpad(nextval('public.pedidos_codigo_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pedidos_set_codigo on public.pedidos;
create trigger trg_pedidos_set_codigo
  before insert on public.pedidos
  for each row execute function public.set_pedido_codigo();

drop trigger if exists trg_pedidos_actualizado_en on public.pedidos;
create trigger trg_pedidos_actualizado_en
  before update on public.pedidos
  for each row execute function public.set_actualizado_en();

-- ===========================================================================
-- 5. VISITAS
-- ===========================================================================
create table if not exists public.visitas (
  id        bigserial primary key,
  fecha     date not null default current_date,
  creado_en timestamptz not null default now()
);

create index if not exists idx_visitas_fecha on public.visitas(fecha);

-- ===========================================================================
-- 6. CONFIG TIENDA (fila única, id = 1)
-- ===========================================================================
create table if not exists public.config_tienda (
  id                  smallint primary key default 1 check (id = 1),
  nombre_tienda       text,
  whatsapp            text,
  instagram           text,
  moneda              text not null default 'ARS',
  umbral_bajo_stock   int  not null default 5,
  actualizado_en      timestamptz not null default now()
);

-- Insertar fila inicial si no existe.
insert into public.config_tienda (id)
values (1)
on conflict (id) do nothing;

drop trigger if exists trg_config_tienda_actualizado_en on public.config_tienda;
create trigger trg_config_tienda_actualizado_en
  before update on public.config_tienda
  for each row execute function public.set_actualizado_en();

-- ===========================================================================
-- RLS · Row Level Security
-- ===========================================================================
alter table public.categorias     enable row level security;
alter table public.productos      enable row level security;
alter table public.variantes      enable row level security;
alter table public.pedidos        enable row level security;
alter table public.visitas        enable row level security;
alter table public.config_tienda  enable row level security;

-- -- Lectura pública (anon + authenticated) ----------------------------------
drop policy if exists "lectura publica" on public.categorias;
create policy "lectura publica" on public.categorias
  for select to anon, authenticated using (true);

drop policy if exists "lectura publica" on public.productos;
create policy "lectura publica" on public.productos
  for select to anon, authenticated using (true);

drop policy if exists "lectura publica" on public.variantes;
create policy "lectura publica" on public.variantes
  for select to anon, authenticated using (true);

drop policy if exists "lectura publica" on public.config_tienda;
create policy "lectura publica" on public.config_tienda
  for select to anon, authenticated using (true);

-- -- Insert público (checkout y tracking de visitas) -------------------------
drop policy if exists "insert publico pedidos" on public.pedidos;
create policy "insert publico pedidos" on public.pedidos
  for insert to anon, authenticated with check (true);

drop policy if exists "insert publico visitas" on public.visitas;
create policy "insert publico visitas" on public.visitas
  for insert to anon, authenticated with check (true);

-- -- Resto de operaciones: solo authenticated -------------------------------
-- categorias
drop policy if exists "admin all" on public.categorias;
create policy "admin all" on public.categorias
  for all to authenticated using (true) with check (true);

-- productos
drop policy if exists "admin all" on public.productos;
create policy "admin all" on public.productos
  for all to authenticated using (true) with check (true);

-- variantes
drop policy if exists "admin all" on public.variantes;
create policy "admin all" on public.variantes
  for all to authenticated using (true) with check (true);

-- pedidos: ya tienen insert público; ahora SELECT/UPDATE/DELETE auth
drop policy if exists "admin select pedidos" on public.pedidos;
create policy "admin select pedidos" on public.pedidos
  for select to authenticated using (true);

drop policy if exists "admin update pedidos" on public.pedidos;
create policy "admin update pedidos" on public.pedidos
  for update to authenticated using (true) with check (true);

drop policy if exists "admin delete pedidos" on public.pedidos;
create policy "admin delete pedidos" on public.pedidos
  for delete to authenticated using (true);

-- visitas: select solo auth (insert ya público)
drop policy if exists "admin select visitas" on public.visitas;
create policy "admin select visitas" on public.visitas
  for select to authenticated using (true);

drop policy if exists "admin delete visitas" on public.visitas;
create policy "admin delete visitas" on public.visitas
  for delete to authenticated using (true);

-- config_tienda: update solo auth (lectura ya pública)
drop policy if exists "admin update config" on public.config_tienda;
create policy "admin update config" on public.config_tienda
  for update to authenticated using (true) with check (true);

-- ============================================================================
-- Fin migración. Tablas creadas: categorias, productos, variantes, pedidos,
-- visitas, config_tienda (fila id=1 insertada). Triggers actualizado_en y
-- pedido_codigo activos. RLS habilitado en todas con policies anon/auth.
-- ============================================================================
