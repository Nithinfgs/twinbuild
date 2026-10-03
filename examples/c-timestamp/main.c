#include <stdio.h>

int main(void) {
  printf("built %s %s from %s\n", __DATE__, __TIME__, __FILE__);
  return 0;
}
