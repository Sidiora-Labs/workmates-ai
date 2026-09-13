try {
        var stored = localStorage.getItem("workmates-theme");
        var dark =
          stored === "dark" ||
          ((!stored || stored === "system") &&
            matchMedia("(prefers-color-scheme: dark)").matches);
        if (dark) document.documentElement.classList.add("dark");
        if (/Electron/.test(navigator.userAgent) && /Mac/.test(navigator.platform))
          document.documentElement.classList.add("mac-vibrancy");
      } catch (e) {}
