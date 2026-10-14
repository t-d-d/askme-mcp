# Restoring the table

The table keeps point-in-time recovery for 35 days. It stays when the stack is deleted or would replace it, and it has deletion protection. A restore makes a new table and leaves the live one alone, so restoring is two steps: restore a copy, then copy its items back into the live table. Run this in CloudShell in `us-east-1`, with the time to go back to in UTC:

```
LIVE=$(aws cloudformation describe-stack-resource --stack-name askme-prod \
  --logical-resource-id Table \
  --query StackResourceDetail.PhysicalResourceId --output text)
aws dynamodb restore-table-to-point-in-time \
  --source-table-name "$LIVE" --target-table-name askme-restored \
  --restore-date-time 2026-01-31T12:00:00Z
until [ "$(aws dynamodb describe-table --table-name askme-restored \
  --query Table.TableStatus --output text)" = ACTIVE ]; do sleep 30; done
aws dynamodb scan --table-name askme-restored --query Items --output json \
  | jq -c '.[]' | while read -r item; do
      aws dynamodb put-item --table-name "$LIVE" --item "$item" \
        --condition-expression "attribute_not_exists(pk)" 2>/dev/null \
        || echo "Not copied: $item"
    done
```

A restore can take longer than the eight minutes or so that `aws dynamodb wait table-exists` allows, so the loop checks every 30 seconds. The copy adds only the items the live table lacks, and prints each one it leaves alone. It never overwrites a live item, because an older copy of an account's `META` or of an ask would put back a lower version or reopen a closed ask. If a live item itself is wrong, decide what to do with it by hand. Check the copy, then delete the restored table with `aws dynamodb delete-table --table-name askme-restored`.

If the stack was deleted and deployed again, or replaced the table, the old table is still there under its old name, which `aws dynamodb list-tables` shows. Copy from it in the same way, with its name in place of `askme-restored`, and keep it until the copy is checked.
