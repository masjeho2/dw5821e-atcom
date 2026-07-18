/*
 * at_exec - simple AT command runner for serial ports
 * Usage: at_exec <port> <command> [timeout_ms]
 *
 * Example:
 *   at_exec /dev/ttyUSB1 ATI 5000
 *   at_exec /dev/ttyUSB1 'AT^NV=550' 8000
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <sys/select.h>

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <port> <command> [timeout_ms]\n", argv[0]);
        return 1;
    }

    const char *port = argv[1];
    const char *cmd = argv[2];
    int timeout_ms = argc > 3 ? atoi(argv[3]) : 5000;
    if (timeout_ms < 500) timeout_ms = 500;

    int fd = open(port, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) {
        fprintf(stderr, "Cannot open %s: ", port);
        perror("");
        return 1;
    }

    struct termios tty;
    memset(&tty, 0, sizeof(tty));
    tty.c_cflag = B115200 | CS8 | CLOCAL | CREAD;
    tty.c_iflag = IGNPAR;
    tty.c_oflag = 0;
    tty.c_lflag = 0;
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 0;

    tcflush(fd, TCIOFLUSH);
    tcsetattr(fd, TCSANOW, &tty);

    /* Flush old data */
    char tmp[4096];
    while (read(fd, tmp, sizeof(tmp)) > 0) {}
    tcflush(fd, TCIOFLUSH);

    /* Send command */
    write(fd, cmd, strlen(cmd));
    write(fd, "\r", 1);

    /* Read response with timeout */
    char buf[8192];
    int total = 0;
    int elapsed = 0;
    int step = 100000; /* 100ms */

    while (elapsed < timeout_ms * 1000) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(fd, &fds);
        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = step;

        if (select(fd + 1, &fds, NULL, NULL, &tv) > 0) {
            int n = read(fd, buf + total, (int)sizeof(buf) - 1 - total);
            if (n > 0) {
                total += n;
                buf[total] = 0;
                if (strstr(buf, "\r\nOK\r\n") || strstr(buf, "\r\nERROR\r\n") ||
                    strstr(buf, "\nOK\n") || strstr(buf, "\nERROR\n") ||
                    strstr(buf, "OK\r") || strstr(buf, "ERROR\r")) {
                    break;
                }
            }
        }
        elapsed += step;
        if (total >= (int)sizeof(buf) - 1) break;
    }

    if (total > 0) {
        buf[total] = 0;
        char *start = buf;
        while (*start == '\r' || *start == '\n') start++;
        printf("%s", start);
    } else {
        printf("(no response)");
    }

    close(fd);
    return 0;
}
