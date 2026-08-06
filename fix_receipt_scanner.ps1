$file = "app/(tabs)/index.tsx"
$content = Get-Content $file -Raw

$old = "                const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','x-api-key':'YOUR_ACTUAL_KEY_HERE'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:500,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},{type:'text',text:'Extract receipt info. Return ONLY JSON with: vendor, amount (number), date (YYYY-MM-DD), category (one of: Advertising & Marketing, Bank Charges, Equipment, Insurance, Legal & Professional Fees, Meals & Entertainment, Office Supplies, Payroll, Rent & Lease, Software & Subscriptions, Taxes & Licenses, Travel, Utilities, Vehicle, Other). No explanation.'}]}]})});
                const j=await r.json();
                const info=JSON.parse(j.content[0].text.replace(/```json|```/g,'').trim());"

$new = "                const r=await fetch(API+'/orgs/'+org.id+'/receipts/scan',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({imageBase64:b64,mediaType:'image/jpeg'})});
                const j=await r.json();
                if(!j.success)throw new Error(j.message);
                const info=j.data;"

$content.Replace($old, $new) | Set-Content $file
Write-Host "Done!"