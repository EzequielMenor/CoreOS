export const FTS_TRIGGER_DDL = `
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TRIGGER IF EXISTS note_tags_ai;
DROP TRIGGER IF EXISTS note_tags_ad;

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = new.id;
  INSERT INTO notes_fts(rowid, title, body_md, tags_names)
    SELECT n.id, n.title, n.body_md,
      COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
        FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id), '')
    FROM notes n WHERE n.id = new.id;
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
END;

-- Mantener OF title, body_md: los triggers de etiquetas actualizan notes.updated_at y un UPDATE sin OF recursaría.
CREATE TRIGGER notes_au AFTER UPDATE OF title, body_md ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = new.id;
  INSERT INTO notes_fts(rowid, title, body_md, tags_names)
    SELECT n.id, n.title, n.body_md,
      COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
        FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id), '')
    FROM notes n WHERE n.id = new.id;
END;

-- Los triggers de etiquetas deben reescribir tags_names porque cambian sin modificar title ni body_md.
CREATE TRIGGER note_tags_ai AFTER INSERT ON note_tags BEGIN
  UPDATE notes SET updated_at = (unixepoch()) WHERE id = new.note_id;
  DELETE FROM notes_fts WHERE rowid = new.note_id;
  INSERT INTO notes_fts(rowid, title, body_md, tags_names)
    SELECT n.id, n.title, n.body_md,
      COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
        FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id), '')
    FROM notes n WHERE n.id = new.note_id;
END;

CREATE TRIGGER note_tags_ad AFTER DELETE ON note_tags BEGIN
  UPDATE notes SET updated_at = (unixepoch()) WHERE id = old.note_id;
  DELETE FROM notes_fts WHERE rowid = old.note_id;
  INSERT INTO notes_fts(rowid, title, body_md, tags_names)
    SELECT n.id, n.title, n.body_md,
      COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
        FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id), '')
    FROM notes n WHERE n.id = old.note_id;
END;
`;

export const FTS_REINDEX_SQL = `
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, title, body_md, tags_names)
  SELECT n.id, n.title, n.body_md,
    COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
      FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id), '')
  FROM notes n;
`;
