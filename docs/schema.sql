-- SQLite (better-sqlite3). Single local user, so no owner column and no row level security.
-- Times are ISO-8601 UTC text (SQLite has no timestamptz).
pragma foreign_keys = on;

create table downloads (
  id text primary key,                       -- uuid generated in app
  url text not null,
  final_url text,
  file_name text not null,
  save_path text not null,
  temp_path text not null,
  size_bytes integer,                        -- null until known
  downloaded_bytes integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued','downloading','paused','completed','failed','cancelled')),
  connections integer not null default 8 check (connections between 1 and 32),
  speed_limit integer,                       -- bytes/sec, null = global/unlimited
  resumable integer not null default 0 check (resumable in (0,1)),
  etag text,
  last_modified text,
  headers_json text not null default '{}',   -- referer, cookies, user-agent
  error text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at text
);
create index downloads_status on downloads (status);
create index downloads_created on downloads (created_at);

create table segments (
  id integer primary key autoincrement,
  download_id text not null references downloads(id) on delete cascade,
  idx integer not null,
  start_byte integer not null,
  end_byte integer not null,
  downloaded_bytes integer not null default 0,
  status text not null default 'pending' check (status in ('pending','active','done','failed')),
  unique (download_id, idx),
  check (end_byte >= start_byte)
);
create index segments_download on segments (download_id);

create table settings (
  key text primary key,
  value text not null
);
-- defaults seeded at first run: download_dir, temp_dir, max_connections=8, max_parallel=3,
-- global_speed_limit=0, capture_enabled=1, capture_min_size=262144, file_type_filters, start_with_windows=0

create table media_items (
  id text primary key,
  page_url text not null,
  media_url text not null,
  kind text not null check (kind in ('video','audio')),
  format text,
  size_bytes integer,
  title text,
  download_id text references downloads(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index media_page on media_items (page_url);
