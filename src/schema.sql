CREATE TABLE management_categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
 sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1))
);
CREATE TABLE products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 master_title TEXT NOT NULL CHECK(length(trim(master_title))>0),
 master_description TEXT NOT NULL DEFAULT '', hashtags_text TEXT NOT NULL DEFAULT '',
 category_id INTEGER REFERENCES management_categories(id) ON DELETE RESTRICT,
 organization_status TEXT NOT NULL DEFAULT 'unorganized' CHECK(organization_status IN('unorganized','ready')),
 lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN('active','sold','withdrawn')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE legacy_product_links (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 source_system TEXT NOT NULL DEFAULT 'flea-assistant-v1', legacy_product_id INTEGER NOT NULL CHECK(legacy_product_id>0),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(source_system,legacy_product_id)
);
CREATE TABLE import_batches (
 id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL CHECK(site IN('mercari','yahoo','rakuma')),
 filename TEXT NOT NULL, file_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('completed','failed')),
 summary_json TEXT NOT NULL DEFAULT '{}', error_message TEXT,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE import_rows (
 id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
 row_number INTEGER NOT NULL, raw_json TEXT NOT NULL, parsed_json TEXT,
 outcome TEXT NOT NULL CHECK(outcome IN('new','updated','unchanged','review','error')),
 product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT, listing_id INTEGER REFERENCES listings(id) ON DELETE RESTRICT,
 reason TEXT, UNIQUE(batch_id,row_number)
);
CREATE TABLE listings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 site TEXT NOT NULL CHECK(site IN('mercari','yahoo','rakuma')),
 site_item_id TEXT NOT NULL CHECK(length(trim(site_item_id))>0),
 site_title TEXT NOT NULL, site_description TEXT NOT NULL DEFAULT '', site_hashtags_text TEXT NOT NULL DEFAULT '',
 price INTEGER CHECK(price>=0), status TEXT NOT NULL CHECK(status IN('active','paused','sold','ended','unknown')),
 source_status TEXT NOT NULL DEFAULT '', listed_at TEXT, ended_at TEXT,
 last_seen_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 import_row_id INTEGER REFERENCES import_rows(id) ON DELETE RESTRICT,
 link_method TEXT NOT NULL DEFAULT 'manual' CHECK(link_method IN('manual','mercari_initial','explicit_fm','known_site_id','yahoo_mapping','rakuma_exact')),
 UNIQUE(site,site_item_id)
);
CREATE INDEX listings_product_site ON listings(product_id,site);
CREATE TABLE product_photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 filename TEXT NOT NULL UNIQUE CHECK(length(filename)>0 AND instr(filename,'/')=0 AND instr(filename,char(92))=0 AND instr(filename,':')=0 AND filename NOT IN('.','..')),
 sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order>=0), source_site TEXT CHECK(source_site IN('mercari','yahoo','rakuma')),
 source_listing_id INTEGER REFERENCES listings(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE import_review_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id) ON DELETE RESTRICT,
 reason_code TEXT NOT NULL, reason TEXT NOT NULL, candidate_product_ids_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','resolved','excluded')),
 resolved_product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT, resolution_note TEXT, resolved_at TEXT
);
CREATE TABLE yahoo_initial_mappings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, yahoo_site_item_id TEXT NOT NULL UNIQUE,
 decision TEXT NOT NULL CHECK(decision IN('matched','yahoo_only','hold','exclude')), mercari_site_item_id TEXT,
 product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT, import_row_id INTEGER REFERENCES import_rows(id) ON DELETE RESTRICT,
 note TEXT NOT NULL DEFAULT '', CHECK(decision!='matched' OR (mercari_site_item_id IS NOT NULL AND length(trim(mercari_site_item_id))>0))
);
