// Universal Fullscreen Utility for Games
class FullscreenManager {
  constructor(gameSelector = '.game-container', buttonSelector = '.fullscreen-btn') {
    this.gameContainer = document.querySelector(gameSelector);
    this.fullscreenBtn = document.querySelector(buttonSelector);
    this.isFullscreen = false;
    this.exitFullscreenBtn = null;
    this.originalParent = null;
    
    this.init();
  }
  
  init() {
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => this.enterFullscreen());
    }
    
    // Exit fullscreen on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.exitFullscreen();
      }
    });
    
    // Handle browser fullscreen API changes
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.isFullscreen) {
        this.exitFullscreen();
      }
    });
  }
  
  enterFullscreen() {
    this.isFullscreen = true;
    document.body.classList.add('fullscreen-mode');
    
    // Store original parent
    this.originalParent = this.gameContainer?.parentElement;
    
    // Create exit button
    this.exitFullscreenBtn = document.createElement('button');
    this.exitFullscreenBtn.className = 'exit-fullscreen-btn';
    this.exitFullscreenBtn.innerHTML = '✕ Exit Fullscreen';
    this.exitFullscreenBtn.onclick = () => this.exitFullscreen();
    document.body.appendChild(this.exitFullscreenBtn);
    
    // Hide fullscreen button
    if (this.fullscreenBtn) {
      this.fullscreenBtn.style.display = 'none';
    }
    
    // Try to use browser fullscreen API
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        // Fallback to CSS fullscreen if browser API fails
        console.log('Browser fullscreen not available, using CSS fullscreen');
      });
    }
  }
  
  exitFullscreen() {
    this.isFullscreen = false;
    document.body.classList.remove('fullscreen-mode');
    
    // Remove exit button
    if (this.exitFullscreenBtn) {
      this.exitFullscreenBtn.remove();
      this.exitFullscreenBtn = null;
    }
    
    // Show fullscreen button
    if (this.fullscreenBtn) {
      this.fullscreenBtn.style.display = 'block';
    }
    
    // Exit browser fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        console.log('Could not exit browser fullscreen');
      });
    }
  }
}

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Check if fullscreen button exists and initialize
  if (document.querySelector('.fullscreen-btn')) {
    new FullscreenManager();
  }
});