# A stand-in input box for the auto-learn tracking self-test (REA_SELFTEST_LEARN=track):
# shows the "pasted" text, changes it the way a user fixing a word would, then
# optionally clears it the way sending a chat message does. Prints each step.
param([string]$Text, [string]$Fixed, [int]$FixAfterMs = 4000, [int]$ClearAfterMs = 0, [int]$CloseAfterMs = 15000)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Saydra track test'
$form.TopMost = $true
$form.Width = 520; $form.Height = 200
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.Dock = 'Fill'; $box.Text = $Text
$form.Controls.Add($box)
$start = [DateTime]::Now
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$state = @{ fixed = $false; cleared = $false }
$timer.Add_Tick({
  $ms = ([DateTime]::Now - $start).TotalMilliseconds
  if ($ms -lt 3000 -and -not $form.ContainsFocus) { $form.Activate(); $box.Focus() }
  if (-not $state.fixed -and $ms -ge $FixAfterMs) { $box.Text = $Fixed; $box.SelectionStart = $box.Text.Length; $state.fixed = $true; [Console]::Out.WriteLine('fixed') }
  if ($ClearAfterMs -gt 0 -and -not $state.cleared -and $ms -ge $ClearAfterMs) { $box.Text = ''; $state.cleared = $true; [Console]::Out.WriteLine('cleared') }
  if ($ms -ge $CloseAfterMs) { $form.Close() }
})
$form.Add_Shown({ $form.Activate(); $box.Focus(); $box.SelectionStart = $box.Text.Length; $timer.Start(); [Console]::Out.WriteLine('shown') })
[void]$form.ShowDialog()
