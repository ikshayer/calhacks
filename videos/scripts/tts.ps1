# Generates one WAV per scene with the built-in Windows voice (no API key).
# Temporary voiceover for pipeline testing; swap for a better TTS before the final demo videos.
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$campaigns = Get-Content (Join-Path $root "src/campaigns.json") -Raw | ConvertFrom-Json
$outDir = Join-Path $root "public/voice"
New-Item -ItemType Directory -Force $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
foreach ($variant in $campaigns.PSObject.Properties) {
  foreach ($scene in $variant.Value) {
    $path = Join-Path $outDir "$($scene.id).wav"
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($scene.voice)
    Write-Output "wrote $path"
  }
}
$synth.SetOutputToNull()
$synth.Dispose()
