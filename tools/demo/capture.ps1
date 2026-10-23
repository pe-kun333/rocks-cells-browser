# Capture the test Rocks-cells Browser window as JPEG frames (about 5 per second) until a "stop" file appears in -Dir.
# Writes f00000.jpg ..., frames.txt (index and time in ms) and meta.json (client size and DPI scale).
# Usually started by record.ps1.
param([string]$Dir, [int]$Pid0, [int]$OutW = 1680, [int]$Fps = 5, [int]$WinW = 1400, [int]$WinH = 915)
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

public static class Cap {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(int action, int param, ref RECT r, int winIni);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

  public static void Run(string dir, int pid, int outW, int fps, int winW, int winH) {
    SetProcessDPIAware();
    var hwnd = Process.GetProcessById(pid).MainWindowHandle;
    // window size in DIP, scaled by the window's DPI and kept inside the work area
    double scale = GetDpiForWindow(hwnd) / 96.0;
    var work = new RECT();
    SystemParametersInfo(0x30 /* SPI_GETWORKAREA */, 0, ref work, 0);
    int w = Math.Min((int)(winW * scale), work.R - work.L - 40);
    int h = Math.Min((int)(winH * scale), work.B - work.T - 30);
    SetWindowPos(hwnd, IntPtr.Zero, work.L + 20, work.T + 10, w, h, 0x0004 /* NOZORDER */);
    Thread.Sleep(800);
    var enc = ImageCodecInfo.GetImageEncoders().First(e => e.MimeType == "image/jpeg");
    var ps = new EncoderParameters(1);
    ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 84L);
    var index = new StreamWriter(Path.Combine(dir, "frames.txt"));
    var sw = Stopwatch.StartNew();
    int n = 0;
    bool metaDone = false;
    while (!File.Exists(Path.Combine(dir, "stop"))) {
      long started = sw.ElapsedMilliseconds;
      RECT wr, cr; GetWindowRect(hwnd, out wr); GetClientRect(hwnd, out cr);
      var origin = new POINT(); ClientToScreen(hwnd, ref origin);
      int ww = wr.R - wr.L, wh = wr.B - wr.T, cw = cr.R, ch = cr.B;
      if (ww > 0 && wh > 0 && cw > 0 && ch > 0) {
        using (var full = new Bitmap(ww, wh, PixelFormat.Format32bppArgb)) {
          using (var g = Graphics.FromImage(full)) {
            var hdc = g.GetHdc();
            PrintWindow(hwnd, hdc, 2 /* PW_RENDERFULLCONTENT */);
            g.ReleaseHdc(hdc);
          }
          int ox = origin.X - wr.L, oy = origin.Y - wr.T;
          int outH = (int)Math.Round(outW * (double)ch / cw);
          using (var small = new Bitmap(outW, outH, PixelFormat.Format24bppRgb)) {
            using (var g = Graphics.FromImage(small)) {
              g.InterpolationMode = InterpolationMode.HighQualityBicubic;
              g.DrawImage(full, new Rectangle(0, 0, outW, outH), new Rectangle(ox, oy, cw, ch), GraphicsUnit.Pixel);
            }
            small.Save(Path.Combine(dir, string.Format("f{0:D5}.jpg", n)), enc, ps);
            long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            index.WriteLine(n + " " + now);
            index.Flush();
            n++;
          }
          if (!metaDone) {
            File.WriteAllText(Path.Combine(dir, "meta.json"), "{\"clientW\":" + cw + ",\"clientH\":" + ch + ",\"scale\":" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"outW\":" + outW + ",\"outH\":" + outH + "}");
            metaDone = true;
          }
        }
      }
      long wait = 1000 / Math.Max(1, fps) - (sw.ElapsedMilliseconds - started);
      if (wait > 0) Thread.Sleep((int)wait);
    }
    index.Close();
  }
}
'@
[Cap]::Run($Dir, $Pid0, $OutW, $Fps, $WinW, $WinH)
