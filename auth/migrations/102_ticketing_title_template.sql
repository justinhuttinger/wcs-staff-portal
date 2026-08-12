-- Custom ticket titles per type.
--
-- Until now a ticket's title was derived automatically: the first non-blank
-- short/long text answer, else the type name. That reads poorly for types
-- whose first text field isn't identifying ("Notes", "Reason", ...).
--
-- title_template lets an admin write the title in the type builder, mixing
-- literal words with field tokens, e.g.:
--
--   Ticket for {{f_a1b2c3}}          ->  "Ticket for Jane Doe"
--   {{f_loc}} — new hire {{f_name}}  ->  "Medford — new hire Jane Doe"
--
-- Tokens are field ids from the type's own schema. Unfilled tokens render
-- empty and the whitespace is collapsed; a template that renders to nothing
-- falls back to the old derived title, so this is purely additive.
-- NULL / empty template = keep the previous behavior.

alter table ticket_types
  add column if not exists title_template text;
