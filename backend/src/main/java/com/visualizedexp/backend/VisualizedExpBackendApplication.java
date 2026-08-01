package com.visualizedexp.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class VisualizedExpBackendApplication {
    public static void main(String[] args) {
        SpringApplication.run(VisualizedExpBackendApplication.class, args);
    }
}
