# Convert a .docx to PDF with Microsoft Word (read-only, invisible). Used by host.py.
param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  # Open(FileName, ConfirmConversions=false, ReadOnly=true, AddToRecentFiles=false)
  $doc = $word.Documents.Open($Src, $false, $true, $false)
  $doc.ExportAsFixedFormat($Out, 17)   # 17 = wdExportFormatPDF
} finally {
  if ($doc) { $doc.Close([ref]0) }      # 0 = don't save
  # Only quit Word if no other documents are open (never close a Word window you're using)
  if ($word.Documents.Count -eq 0) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
