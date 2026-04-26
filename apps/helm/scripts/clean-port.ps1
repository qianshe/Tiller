$conn = Get-NetTCPConnection -LocalPort 47631 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
