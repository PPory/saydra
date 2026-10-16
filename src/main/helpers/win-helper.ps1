# Saydra system helper: one long-lived Windows PowerShell process.
# Reads JSON requests from stdin, one per line, and answers one JSON line each:
#   {"id":1,"cmd":"focus","before":500}  -> text of the focused input box, its selection, text before the caret
#   {"id":2,"cmd":"watch"}                -> like focus, and remembers that box for "watched"
#   {"id":3,"cmd":"watched"}              -> current text of the remembered box, focused or not
#   {"id":4,"cmd":"mute"} / "unmute" / "muted"  -> system output mute (default speakers)
# Every failure is an answer with "ok": false; the app treats this helper as best effort.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Collections;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Automation.Text;

public static class ReaHelper {
    const int MaxDoc = 20000;
    static AutomationElement watched;

    static Hashtable Describe(AutomationElement el, int before) {
        var r = new Hashtable();
        if (el == null) return r;
        var cur = el.Current;
        r["pid"] = cur.ProcessId;
        r["type"] = cur.ControlType.ProgrammaticName.Replace("ControlType.", "");
        r["cls"] = cur.ClassName;
        r["password"] = cur.IsPassword;
        if (cur.IsPassword) return r;
        object p;
        if (el.TryGetCurrentPattern(TextPattern.Pattern, out p)) {
            var tp = (TextPattern)p;
            r["text"] = tp.DocumentRange.GetText(MaxDoc);
            var sel = tp.GetSelection();
            if (sel.Length > 0) {
                var s = sel[0];
                r["selection"] = s.GetText(MaxDoc);
                if (before > 0) {
                    // From the caret (start of the selection) back by `before` characters.
                    var b = s.Clone();
                    b.MoveEndpointByRange(TextPatternRangeEndpoint.End, s, TextPatternRangeEndpoint.Start);
                    b.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -before);
                    r["before"] = b.GetText(before);
                }
            }
        } else if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p)) {
            var v = ((ValuePattern)p).Current.Value ?? "";
            r["text"] = v.Length > MaxDoc ? v.Substring(0, MaxDoc) : v;
        }
        return r;
    }

    public static Hashtable Focus(int before, bool watch) {
        var el = AutomationElement.FocusedElement;
        if (watch) watched = el;
        return Describe(el, before);
    }

    public static Hashtable Watched() {
        if (watched == null) return new Hashtable();
        try { return Describe(watched, 0); }
        catch (ElementNotAvailableException) { watched = null; return new Hashtable(); }
    }

    // ---- Core Audio: mute of the default output device ----
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float level, ref Guid context);
        int SetMasterVolumeLevelScalar(float level, ref Guid context);
        int GetMasterVolumeLevel(out float level);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        int GetChannelVolumeLevel(uint channel, out float level);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    static IAudioEndpointVolume Speakers() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0 /* render */, 1 /* multimedia */, out device));
        var iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }

    public static bool IsMuted() {
        bool m;
        Marshal.ThrowExceptionForHR(Speakers().GetMute(out m));
        return m;
    }

    public static void SetMuted(bool mute) {
        var ctx = Guid.Empty;
        Marshal.ThrowExceptionForHR(Speakers().SetMute(mute, ref ctx));
    }
}
'@

function Reply($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

Reply @{ ready = $true }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break } # the app closed our stdin: exit with it
    if (-not $line.Trim()) { continue }
    $id = $null
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $before = if ($req.before) { [int]$req.before } else { 0 }
        switch ($req.cmd) {
            'focus' { $out = [ReaHelper]::Focus($before, $false) }
            'watch' { $out = [ReaHelper]::Focus($before, $true) }
            'watched' { $out = [ReaHelper]::Watched() }
            'muted' { $out = @{ muted = [ReaHelper]::IsMuted() } }
            'mute' { [ReaHelper]::SetMuted($true); $out = @{} }
            'unmute' { [ReaHelper]::SetMuted($false); $out = @{} }
            default { throw "unknown command $($req.cmd)" }
        }
        $out['id'] = $id
        $out['ok'] = $true
        Reply $out
    } catch {
        Reply @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
}
