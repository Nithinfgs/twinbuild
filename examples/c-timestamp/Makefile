# A classic: __DATE__, __TIME__ and __FILE__ are baked into the binary.
# Fix with -Wdate-time -Werror, or -ffile-prefix-map and no __TIME__.
app: main.c
	cc -o app main.c

clean:
	rm -f app
