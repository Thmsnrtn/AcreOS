-- 0284 — correct the seeded "Assignment Contract" system template's parties
-- (P1 false-claims sweep, 2026-10-20). It labelled {{seller_name}} — filled
-- from the deal's SELLER lead — as the ASSIGNOR. The assignor is the original
-- BUYER under the purchase contract; the seller is not a party to the
-- assignment. seedSystemTemplates() only seeds an empty table, so databases
-- that already hold the template need this UPDATE. Idempotent: the WHERE
-- matches only the uncorrected body. Mirrored in scripts/migrate.mjs.
UPDATE "document_templates"
   SET "content" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("content",
         '<strong>ASSIGNOR:</strong> {{seller_name}}', '<strong>ASSIGNOR:</strong> {{assignor_name}}'),
         '<strong>ASSIGNEE:</strong> {{buyer_name}}', '<strong>ASSIGNEE:</strong> {{assignee_name}}'),
         'Assignor: {{seller_name}}', 'Assignor: {{assignor_name}}'),
         'Assignee: {{buyer_name}}', 'Assignee: {{assignee_name}}'),
         'Assignor entered into a Real Estate Purchase Agreement dated {{original_contract_date}} ("Original Contract")',
         'Assignor, as buyer, entered into a Real Estate Purchase Agreement dated {{original_contract_date}} with {{seller_name}}, as seller ("Original Contract")'),
       "variables" = '[
         {"name":"assignor_name","description":"Full legal name of the assignor — the original BUYER under the purchase contract","type":"text","required":true},
         {"name":"assignee_name","description":"Full legal name of the assignee — the party stepping into the buyer position under the original contract","type":"text","required":true},
         {"name":"seller_name","description":"Full legal name of the property seller under the original contract (not a party to this assignment)","type":"text","required":true},
         {"name":"property_address","description":"Full street address of the property","type":"text","required":true},
         {"name":"parcel_number","description":"APN/Parcel number","type":"text","required":true},
         {"name":"county","description":"County where property is located","type":"text","required":true},
         {"name":"state","description":"State where property is located","type":"text","required":true},
         {"name":"purchase_price","description":"Original purchase price","type":"currency","required":true},
         {"name":"assignment_fee","description":"Assignment fee amount","type":"currency","required":true},
         {"name":"closing_date","description":"Date of assignment","type":"date","required":true},
         {"name":"original_contract_date","description":"Date of original purchase contract","type":"date","required":true}
       ]'::jsonb,
       "updated_at" = now()
 WHERE "is_system_template" = true
   AND "content" LIKE '%<strong>ASSIGNOR:</strong> {{seller_name}}%';
