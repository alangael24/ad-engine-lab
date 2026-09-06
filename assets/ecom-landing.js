(function () {
  "use strict";

  const shell = document.querySelector("[data-video-shell]");
  const video = document.querySelector("[data-hero-video]");

  if (shell && video) {
    const playVideo = async () => {
      try {
        video.muted = false;
        await video.play();
        shell.classList.add("is-playing");
      } catch {
        video.muted = true;
        await video.play().catch(() => {});
        shell.classList.add("is-playing");
      }
    };

    shell.addEventListener("click", playVideo);
    shell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      playVideo();
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const media = entry.target;
        if (entry.isIntersecting) media.play().catch(() => {});
        else media.pause();
      });
    },
    { rootMargin: "180px 0px", threshold: 0.01 },
  );

  document.querySelectorAll(".cr-video-card video").forEach((media) => {
    observer.observe(media);
  });
})();
