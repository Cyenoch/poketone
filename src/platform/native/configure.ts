// SDL desktop fullscreen stays on the current display instead of creating a macOS Space.
// Configure before SDL initializes: its synchronous Spaces transition fails on macOS 26.
process.env.SDL_VIDEO_MAC_FULLSCREEN_SPACES = "0";
